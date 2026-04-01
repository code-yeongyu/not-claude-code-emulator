/**
 * OpenAPI configuration
 */

import { OpenAPIHono, z } from '@hono/zod-openapi'

export const app = new OpenAPIHono()

export const openApiConfig = {
	openapi: '3.1.0',
	info: {
		title: 'not-claude-code-emulator',
		version: '1.0.0',
		description: 'A Hono-based OAuth server for Anthropic API with Claude Code integration',
		contact: {
			name: 'API Support',
			email: 'support@example.com',
		},
	},
	servers: [
		{
			url: 'http://localhost:3000',
			description: 'Local development server',
		},
	],
	tags: [
		{
			name: 'Anthropic API',
			description: 'Proxy endpoints for Anthropic Messages API',
		},
		{
			name: 'Health',
			description: 'Health check and status endpoints',
		},
	],
}

// Common schemas
export const ErrorSchema = z
	.object({
		error: z.object({
			type: z.string().openapi({
				description: 'Error type',
				example: 'invalid_request_error',
			}),
			message: z.string().openapi({
				description: 'Error message',
				example: 'Invalid request parameters',
			}),
		}),
	})
	.openapi('ErrorResponse')

export const MessageRequestSchema = z
	.object({
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
					role: z.enum(['user', 'assistant']).openapi({
						description: 'Message role',
						example: 'user',
					}),
					content: z.union([z.string(), z.array(z.any())]).openapi({
						description: 'Message content',
						example: 'Hello, Claude!',
					}),
				}),
			)
			.openapi({
				description: 'Conversation messages',
			}),
		system: z
			.union([z.string(), z.array(z.any())])
			.optional()
			.openapi({
				description: 'System prompt',
				example: 'You are a helpful assistant.',
			}),
		temperature: z.number().min(0).max(1).optional().openapi({
			description: 'Sampling temperature',
			example: 0.7,
		}),
		stream: z.boolean().optional().openapi({
			description: 'Enable streaming response',
			example: false,
		}),
		tools: z.array(z.any()).optional().openapi({
			description: 'Available tools',
		}),
		tool_choice: z.any().optional().openapi({
			description: 'Tool choice configuration',
		}),
		thinking: z
			.object({
				type: z.literal('enabled'),
				budget_tokens: z.number().int().positive(),
			})
			.optional()
			.openapi({
				description: 'Thinking mode configuration',
			}),
	})
	.openapi('MessageRequest')

export const MessageResponseSchema = z
	.object({
		id: z.string().openapi({
			description: 'Message ID',
			example: 'msg_01Xxxxxxxxxxxxxxxxx',
		}),
		type: z.literal('message').openapi({
			description: 'Response type',
		}),
		role: z.literal('assistant').openapi({
			description: 'Message role',
		}),
		model: z.string().openapi({
			description: 'Model used',
			example: 'claude-sonnet-4-5-20250929',
		}),
		content: z.array(z.any()).openapi({
			description: 'Response content blocks',
		}),
		stop_reason: z
			.enum(['end_turn', 'max_tokens', 'stop_sequence', 'tool_use'])
			.nullable()
			.openapi({
				description: 'Reason for stopping',
			}),
		stop_sequence: z.string().nullable().openapi({
			description: 'Stop sequence if applicable',
		}),
		usage: z
			.object({
				input_tokens: z.number().int().openapi({
					description: 'Input tokens used',
					example: 10,
				}),
				output_tokens: z.number().int().openapi({
					description: 'Output tokens generated',
					example: 100,
				}),
			})
			.openapi({
				description: 'Token usage statistics',
			}),
	})
	.openapi('MessageResponse')
