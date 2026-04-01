import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import {
	AuthenticationError,
	NonRetryableError,
	RateLimitError,
	RetryableError,
	callAnthropicApi,
	resolveOAuthToken,
} from '../services/oauth-client.js'
import { transformRequest } from '../services/request-transformer.js'
import {
	createTelemetryContext,
	extractUsageFromJson,
	findUsageInStreamChunk,
	logTelemetry,
	updateStreamUsage,
} from '../services/telemetry.js'
import { normalizeSseChunk, normalizeToolUseNames } from '../services/tool-name-normalizer.js'
import { sendUsageMetrics } from '../services/usage-metrics.js'
import type { MessageCreateParams } from '../types/messages.js'

function canUseStoredTokenFallback(hostHeader: string | undefined): boolean {
	if (!hostHeader) {
		return false
	}

	const hostname = hostHeader.split(':')[0]
	return (
		hostname === 'localhost' ||
		hostname === '127.0.0.1' ||
		hostname === '[::1]' ||
		hostname === '::1'
	)
}

const messagesRoute = new OpenAPIHono()

const healthRoute = createRoute({
	method: 'get',
	path: '/health',
	tags: ['Health'],
	responses: {
		200: {
			description: 'Server is healthy',
			content: {
				'application/json': {
					schema: z.object({
						status: z.string(),
						timestamp: z.string(),
					}),
				},
			},
		},
	},
})

messagesRoute.openapi(healthRoute, (c) => {
	return c.json({
		status: 'healthy',
		timestamp: new Date().toISOString(),
	})
})

const messageRoute = createRoute({
	method: 'post',
	path: '/v1/messages',
	tags: ['Anthropic API'],
	request: {
		headers: z.object({
			authorization: z.string().optional().openapi({
				description: 'Bearer token for authentication',
				example: 'Bearer sk-ant-oat01-...',
			}),
			'x-api-key': z.string().optional().openapi({
				description: 'API key for authentication',
				example: 'sk-ant-oat01-...',
			}),
			'anthropic-beta': z.string().optional().openapi({
				description: 'Beta features to enable',
				example: 'claude-code-20250219,oauth-2025-04-20',
			}),
		}),
		body: {
			content: {
				'application/json': {
					schema: z.object({
						model: z.string().openapi({
							description: 'Model ID',
							example: 'claude-sonnet-4-5-20250929',
						}),
						max_tokens: z.number().int().positive().openapi({
							description: 'Maximum tokens to generate',
							example: 1024,
						}),
						messages: z
							.array(
								z.object({
									role: z.enum(['user', 'assistant']),
									content: z.union([z.string(), z.array(z.any())]),
								}),
							)
							.openapi({
								description: 'Conversation messages',
							}),
						system: z.union([z.string(), z.array(z.any())]).optional(),
						temperature: z.number().min(0).max(1).optional(),
						stream: z.boolean().optional(),
						tools: z.array(z.any()).optional(),
						tool_choice: z.any().optional(),
						thinking: z
							.object({
								type: z.literal('enabled'),
								budget_tokens: z.number().int().positive(),
							})
							.optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			description: 'Successful response',
			content: {
				'application/json': {
					schema: z.any(),
				},
				'text/event-stream': {
					schema: z.string(),
				},
			},
		},
		401: {
			description: 'Unauthorized - Invalid or missing authentication',
			content: {
				'application/json': {
					schema: z.object({
						error: z.object({
							type: z.string(),
							message: z.string(),
						}),
					}),
				},
			},
		},
		429: {
			description: 'Rate limit exceeded',
			content: {
				'application/json': {
					schema: z.object({
						error: z.object({
							type: z.string(),
							message: z.string(),
						}),
					}),
				},
			},
		},
		500: {
			description: 'Internal server error',
			content: {
				'application/json': {
					schema: z.object({
						error: z.object({
							type: z.string(),
							message: z.string(),
						}),
					}),
				},
			},
		},
	},
})

messagesRoute.openapi(messageRoute, async (c) => {
	const requestId = crypto.randomUUID()
	const startTime = Date.now()

	try {
		const token = await resolveOAuthToken(c.req.header(), {
			allowStoredTokenFallback: canUseStoredTokenFallback(c.req.header('host')),
		})

		const body = await c.req.json<MessageCreateParams>()

		const transformed = await transformRequest({
			body,
			headers: c.req.header(),
		})

		const telemetryCtx = createTelemetryContext(requestId, transformed.requestBody)

		const response = await callAnthropicApi(
			'/v1/messages?beta=true',
			transformed.requestBody,
			token,
			{
				anthropicBetaHeaders: transformed.anthropicBetaHeaders,
				userAgent: c.req.header('user-agent') ?? undefined,
			},
		)

		const duration = Date.now() - startTime

		if (transformed.requestBody.stream && response.body) {
			const originalBody = response.body
			const reader = originalBody.getReader()
			let usageEventBuffer = ''

			const stream = new ReadableStream({
				async start(controller) {
					try {
						while (true) {
							const { done, value } = await reader.read()
							if (done) {
								const finalUsage = findUsageInStreamChunk(usageEventBuffer)
								if (finalUsage) {
									telemetryCtx.usage = updateStreamUsage(telemetryCtx.usage, finalUsage)
								}
								break
							}

							const chunk = new TextDecoder().decode(value)
							usageEventBuffer += chunk
							const completeEvents = usageEventBuffer.split('\n\n')
							usageEventBuffer = completeEvents.pop() ?? ''

							for (const event of completeEvents) {
								const usage = findUsageInStreamChunk(`${event}\n\n`)
								if (usage) {
									telemetryCtx.usage = updateStreamUsage(telemetryCtx.usage, usage)
								}
							}

							const normalizedChunk = normalizeSseChunk(chunk)
							controller.enqueue(new TextEncoder().encode(normalizedChunk))
						}
						controller.close()

						telemetryCtx.response = {
							success: true,
							duration,
						}
						await sendUsageMetrics(telemetryCtx, {
							accessToken: token,
							userAgent: c.req.header('user-agent') ?? undefined,
						})
						logTelemetry(telemetryCtx)
					} catch (error) {
						controller.error(error)

						telemetryCtx.response = {
							success: false,
							duration: Date.now() - startTime,
							errorType: error instanceof Error ? error.name : 'Unknown',
							errorMessage: error instanceof Error ? error.message : String(error),
						}
						logTelemetry(telemetryCtx)
					}
				},
				cancel() {
					reader.cancel()
				},
			})

			return new Response(stream, {
				status: response.status,
				statusText: response.statusText,
				headers: {
					'Content-Type': 'text/event-stream',
					'Cache-Control': 'no-cache',
					Connection: 'keep-alive',
				},
			})
		}

		const responseData = normalizeToolUseNames(await response.json())

		const usage = extractUsageFromJson(responseData)
		if (usage) {
			telemetryCtx.usage = usage
		}

		telemetryCtx.response = {
			success: true,
			statusCode: response.status,
			duration,
		}
		await sendUsageMetrics(telemetryCtx, {
			accessToken: token,
			userAgent: c.req.header('user-agent') ?? undefined,
		})
		logTelemetry(telemetryCtx)

		return c.json(responseData, response.status as 200)
	} catch (error) {
		const duration = Date.now() - startTime

		if (error instanceof AuthenticationError) {
			const telemetryCtx = createTelemetryContext(requestId, { model: 'unknown', stream: false })
			telemetryCtx.response = {
				success: false,
				statusCode: 401,
				duration,
				errorType: 'AuthenticationError',
				errorMessage: error.message,
			}
			logTelemetry(telemetryCtx)

			return c.json(
				{
					error: {
						type: 'authentication_error',
						message: error.message,
					},
				},
				401,
			)
		}

		if (error instanceof RateLimitError) {
			const telemetryCtx = createTelemetryContext(requestId, { model: 'unknown', stream: false })
			telemetryCtx.response = {
				success: false,
				statusCode: 429,
				duration,
				errorType: 'RateLimitError',
				errorMessage: error.message,
			}
			logTelemetry(telemetryCtx)

			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
			}
			if (error.retryAfterSeconds !== null) {
				headers['retry-after'] = String(error.retryAfterSeconds)
			}

			return c.json(
				{
					error: {
						type: 'rate_limit_error',
						message: error.message,
					},
				},
				429,
				headers,
			)
		}

		if (error instanceof RetryableError) {
			const telemetryCtx = createTelemetryContext(requestId, { model: 'unknown', stream: false })
			telemetryCtx.response = {
				success: false,
				statusCode: error.statusCode ?? 500,
				duration,
				errorType: 'RetryableError',
				errorMessage: error.message,
			}
			logTelemetry(telemetryCtx)

			return c.json(
				{
					error: {
						type: 'server_error',
						message: 'Temporary upstream error',
					},
				},
				(error.statusCode as 500) ?? 500,
			)
		}

		if (error instanceof NonRetryableError) {
			const telemetryCtx = createTelemetryContext(requestId, { model: 'unknown', stream: false })
			telemetryCtx.response = {
				success: false,
				statusCode: error.statusCode,
				duration,
				errorType: 'NonRetryableError',
				errorMessage: error.message,
			}
			logTelemetry(telemetryCtx)

			return c.json(
				{
					error: {
						type: 'invalid_request_error',
						message: 'Upstream request failed',
					},
				},
				error.statusCode as 400,
			)
		}

		const telemetryCtx = createTelemetryContext(requestId, { model: 'unknown', stream: false })
		telemetryCtx.response = {
			success: false,
			statusCode: 500,
			duration,
			errorType: 'UnknownError',
			errorMessage: error instanceof Error ? error.message : String(error),
		}
		logTelemetry(telemetryCtx)

		return c.json(
			{
				error: {
					type: 'internal_error',
					message: 'Internal server error',
				},
			},
			500,
		)
	}
})

const verifyTokenRoute = createRoute({
	method: 'post',
	path: '/v1/verify-token',
	tags: ['Health'],
	request: {
		body: {
			content: {
				'application/json': {
					schema: z.object({
						token: z.string().openapi({
							description: 'OAuth token to verify',
							example: 'sk-ant-oat01-...',
						}),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			description: 'Token verification result',
			content: {
				'application/json': {
					schema: z.object({
						valid: z.boolean(),
						token: z.string(),
					}),
				},
			},
		},
	},
})

messagesRoute.openapi(verifyTokenRoute, async (c) => {
	const { token } = await c.req.json<{ token: string }>()

	const { validateOAuthToken } = await import('../services/oauth-client.js')
	const isValid = validateOAuthToken(token)

	return c.json({
		valid: isValid,
		token: token.slice(0, 20) + '...',
	})
})

export { messagesRoute }
