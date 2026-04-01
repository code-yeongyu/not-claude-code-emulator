/**
 * Type definitions for Anthropic API messages
 */

export interface TextBlock {
	type: 'text'
	text: string
	cache_control?: { type: 'ephemeral'; ttl?: '1h' | '5m' }
}

export interface ImageBlock {
	type: 'image'
	source: {
		type: 'base64'
		media_type: string
		data: string
	}
}

export interface ToolUseBlock {
	type: 'tool_use'
	id: string
	name: string
	input: Record<string, unknown>
}

export interface ToolResultBlock {
	type: 'tool_result'
	tool_use_id: string
	content: string | TextBlock[]
	is_error?: boolean
}

export type ContentBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock

export interface Message {
	role: 'user' | 'assistant'
	content: string | ContentBlock[]
}

export interface Tool {
	name: string
	description: string
	input_schema: {
		type: 'object'
		properties: Record<string, unknown>
		required?: string[]
	}
}

export type ToolChoice = 'auto' | 'any' | { type: 'tool'; name: string } | { type: 'none' }

export interface ThinkingConfig {
	type: 'enabled'
	budget_tokens: number
}

export interface MessageCreateParams {
	model: string
	max_tokens: number
	messages: Message[]
	system?: string | TextBlock[]
	temperature?: number
	top_p?: number
	top_k?: number
	stream?: boolean
	tools?: Tool[]
	tool_choice?: ToolChoice
	thinking?: ThinkingConfig
}

export interface MessageResponse {
	id: string
	type: 'message'
	role: 'assistant'
	model: string
	content: ContentBlock[]
	stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null
	stop_sequence: string | null
	usage: {
		input_tokens: number
		output_tokens: number
	}
}

export interface SSEEvent {
	event: string
	data: string
}
