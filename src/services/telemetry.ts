/**
 * Usage telemetry tracking
 */

export interface UsageData {
	inputTokens: number
	outputTokens: number
	thinkingTokens?: number
	cacheCreationInputTokens?: number
	cacheReadInputTokens?: number
}

export interface RequestMetadata {
	model: string
	stream: boolean
	maxTokens?: number
	hasThinking: boolean
}

export interface ResponseMetadata {
	success: boolean
	statusCode?: number
	errorType?: string
	errorMessage?: string
	duration: number
}

export interface TelemetryContext {
	requestId: string
	request: RequestMetadata
	response?: ResponseMetadata
	usage?: UsageData
}

interface AnthropicUsage {
	input_tokens: number
	output_tokens: number
	thinking_tokens?: number
	cache_creation_input_tokens?: number
	cache_read_input_tokens?: number
}

/**
 * Extract usage from JSON response
 */
export function extractUsageFromJson(responseBody: unknown): UsageData | null {
	try {
		const body = responseBody as { usage?: AnthropicUsage }
		const usage = body.usage
		if (!usage) return null

		return {
			inputTokens: usage.input_tokens,
			outputTokens: usage.output_tokens,
			thinkingTokens: usage.thinking_tokens,
			cacheCreationInputTokens: usage.cache_creation_input_tokens,
			cacheReadInputTokens: usage.cache_read_input_tokens,
		}
	} catch {
		return null
	}
}

/**
 * Extract usage from SSE event
 */
function extractUsageFromSSE(eventText: string): UsageData | null {
	try {
		const lines = eventText.split('\n')
		let eventType = ''
		let data = ''

		for (const line of lines) {
			if (line.startsWith('event:')) {
				eventType = line.slice(6).trim()
			} else if (line.startsWith('data:')) {
				data = line.slice(5).trim()
			}
		}

		if ((eventType === 'message_start' || eventType === 'message_delta') && data) {
			if (!data.startsWith('{') || !data.endsWith('}')) {
				return null
			}

			const parsed = JSON.parse(data) as {
				message?: { usage?: AnthropicUsage }
				usage?: AnthropicUsage
			}
			let usage: AnthropicUsage | undefined

			if (eventType === 'message_start' && parsed.message?.usage) {
				usage = parsed.message.usage
			} else if (eventType === 'message_delta' && parsed.usage) {
				usage = parsed.usage
			}

			if (usage) {
				return {
					inputTokens: usage.input_tokens,
					outputTokens: usage.output_tokens,
					thinkingTokens: usage.thinking_tokens,
					cacheCreationInputTokens: usage.cache_creation_input_tokens,
					cacheReadInputTokens: usage.cache_read_input_tokens,
				}
			}
		}

		return null
	} catch {
		return null
	}
}

/**
 * Find usage in SSE chunk
 */
export function findUsageInStreamChunk(chunk: string): UsageData | null {
	const events = chunk.split('\n\n').filter((e) => e.trim())

	for (const event of events) {
		const usage = extractUsageFromSSE(event)
		if (usage) return usage
	}

	return null
}

/**
 * Calculate cost based on model and usage
 */
function calculateCost(model: string, usage: UsageData): number | null {
	const pricing: Record<string, { input: number; output: number }> = {
		'claude-opus-4-5-20251101': { input: 5.0, output: 25.0 },
		'claude-opus-4-1-20250805': { input: 15.0, output: 75.0 },
		'claude-opus-4-20250514': { input: 15.0, output: 75.0 },
		'claude-sonnet-4-5-20250929': { input: 3.0, output: 15.0 },
		'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
		'claude-3-7-sonnet-20250219': { input: 3.0, output: 15.0 },
		'claude-haiku-4-5-20251001': { input: 1.0, output: 5.0 },
		'claude-3-5-haiku-20241022': { input: 0.8, output: 4.0 },
	}

	const datePattern = /-\d{8}$/

	let modelPricing = pricing[model]

	if (!modelPricing) {
		const matchingKeys = Object.keys(pricing).filter((key) => {
			const keyWithoutDate = key.replace(datePattern, '')
			return keyWithoutDate === model
		})

		if (matchingKeys.length > 0) {
			const bestMatch = matchingKeys.sort().reverse()[0]
			if (bestMatch) {
				modelPricing = pricing[bestMatch]
			}
		}
	}

	if (!modelPricing) {
		const inputWithoutDate = model.replace(datePattern, '')
		let bestMatch: string | null = null
		let bestMatchLength = 0

		for (const key of Object.keys(pricing)) {
			const keyWithoutDate = key.replace(datePattern, '')
			if (
				inputWithoutDate.startsWith(keyWithoutDate) ||
				keyWithoutDate.startsWith(inputWithoutDate)
			) {
				const matchLength = Math.min(inputWithoutDate.length, keyWithoutDate.length)
				if (matchLength > bestMatchLength) {
					bestMatchLength = matchLength
					bestMatch = key
				}
			}
		}

		if (bestMatch) {
			modelPricing = pricing[bestMatch]
		}
	}

	if (!modelPricing) return null

	const inputCost = (usage.inputTokens / 1_000_000) * modelPricing.input
	const outputCost = (usage.outputTokens / 1_000_000) * modelPricing.output

	return inputCost + outputCost
}

/**
 * Log telemetry data
 */
export function logTelemetry(ctx: TelemetryContext): void {
	const attributes: Record<string, unknown> = {
		'request.id': ctx.requestId,
		'gen_ai.request.model': ctx.request.model,
		'gen_ai.request.stream': ctx.request.stream,
		'gen_ai.request.has_thinking': ctx.request.hasThinking,
		'response.success': ctx.response?.success,
		'response.duration_ms': ctx.response?.duration,
	}

	if (ctx.request.maxTokens !== undefined) {
		attributes['gen_ai.request.max_tokens'] = ctx.request.maxTokens
	}

	if (ctx.response?.statusCode !== undefined) {
		attributes['response.status_code'] = ctx.response.statusCode
	}

	if (ctx.response?.errorType) {
		attributes['response.error_type'] = ctx.response.errorType
	}

	if (ctx.usage) {
		attributes['gen_ai.usage.input_tokens'] = ctx.usage.inputTokens
		attributes['gen_ai.usage.output_tokens'] = ctx.usage.outputTokens

		if (ctx.usage.thinkingTokens !== undefined) {
			attributes['gen_ai.usage.thinking_tokens'] = ctx.usage.thinkingTokens
		}

		if (ctx.usage.cacheCreationInputTokens !== undefined) {
			attributes['gen_ai.usage.cache_creation_input_tokens'] = ctx.usage.cacheCreationInputTokens
		}

		if (ctx.usage.cacheReadInputTokens !== undefined) {
			attributes['gen_ai.usage.cache_read_input_tokens'] = ctx.usage.cacheReadInputTokens
		}

		const cost = calculateCost(ctx.request.model, ctx.usage)
		if (cost !== null) {
			attributes['operation.cost'] = cost
		}
	}

	if (ctx.response?.success) {
		console.log('[TELEMETRY] Request completed:', JSON.stringify(attributes))
	} else {
		console.error('[TELEMETRY] Request failed:', JSON.stringify(attributes))
	}
}

/**
 * Create telemetry context for a request
 */
export function createTelemetryContext(
	requestId: string,
	requestBody: { model: string; stream?: boolean; max_tokens?: number; thinking?: unknown },
): TelemetryContext {
	return {
		requestId,
		request: {
			model: requestBody.model,
			stream: requestBody.stream ?? false,
			maxTokens: requestBody.max_tokens,
			hasThinking: !!requestBody.thinking,
		},
	}
}
