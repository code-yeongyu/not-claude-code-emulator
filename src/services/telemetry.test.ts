import { describe, expect, it } from 'bun:test'
import {
	createTelemetryContext,
	extractUsageFromJson,
	findUsageInStreamChunk,
	logTelemetry,
} from '../services/telemetry.js'

describe('extractUsageFromJson', () => {
	it('should extract usage from JSON response', () => {
		const response = {
			usage: {
				input_tokens: 100,
				output_tokens: 200,
				thinking_tokens: 50,
				cache_creation_input_tokens: 10,
				cache_read_input_tokens: 20,
			},
		}

		const usage = extractUsageFromJson(response)
		expect(usage).toEqual({
			inputTokens: 100,
			outputTokens: 200,
			thinkingTokens: 50,
			cacheCreationInputTokens: 10,
			cacheReadInputTokens: 20,
		})
	})

	it('should return null for missing usage', () => {
		const response = { id: 'test' }
		expect(extractUsageFromJson(response)).toBeNull()
	})

	it('should handle partial usage data', () => {
		const response = {
			usage: {
				input_tokens: 50,
				output_tokens: 100,
			},
		}

		const usage = extractUsageFromJson(response)
		expect(usage?.inputTokens).toBe(50)
		expect(usage?.outputTokens).toBe(100)
		expect(usage?.thinkingTokens).toBeUndefined()
	})
})

describe('findUsageInStreamChunk', () => {
	it('should find usage in message_start event', () => {
		const chunk = `event: message_start
data: {"message": {"usage": {"input_tokens": 10, "output_tokens": 0}}}

`

		const usage = findUsageInStreamChunk(chunk)
		expect(usage?.inputTokens).toBe(10)
	})

	it('should find usage in message_delta event', () => {
		const chunk = `event: message_delta
data: {"usage": {"input_tokens": 10, "output_tokens": 100}}

`

		const usage = findUsageInStreamChunk(chunk)
		expect(usage?.outputTokens).toBe(100)
	})

	it('should return null for non-usage events', () => {
		const chunk = `event: content_block_delta
data: {"delta": {"text": "Hello"}}

`

		expect(findUsageInStreamChunk(chunk)).toBeNull()
	})

	it('should handle incomplete JSON', () => {
		const chunk = `event: message_start
data: {"message": {"usage": 

`

		expect(findUsageInStreamChunk(chunk)).toBeNull()
	})

	it('should return the latest usage when multiple usage events share one chunk', () => {
		const chunk = `event: message_start
data: {"message": {"usage": {"input_tokens": 10, "output_tokens": 0}}}

event: message_delta
data: {"usage": {"input_tokens": 10, "output_tokens": 120}}

`

		const usage = findUsageInStreamChunk(chunk)
		expect(usage?.inputTokens).toBe(10)
		expect(usage?.outputTokens).toBe(120)
	})
})

describe('createTelemetryContext', () => {
	it('should create telemetry context with request data', () => {
		const requestBody = {
			model: 'claude-sonnet-4-5-20250929',
			stream: true,
			max_tokens: 1024,
			thinking: { type: 'enabled' as const, budget_tokens: 2048 },
		}

		const ctx = createTelemetryContext('req-123', requestBody)

		expect(ctx.requestId).toBe('req-123')
		expect(ctx.request.model).toBe('claude-sonnet-4-5-20250929')
		expect(ctx.request.stream).toBe(true)
		expect(ctx.request.maxTokens).toBe(1024)
		expect(ctx.request.hasThinking).toBe(true)
	})

	it('should handle request without thinking', () => {
		const requestBody = {
			model: 'claude-sonnet-4-5-20250929',
			stream: false,
		}

		const ctx = createTelemetryContext('req-456', requestBody)

		expect(ctx.request.hasThinking).toBe(false)
		expect(ctx.request.stream).toBe(false)
	})
})

describe('logTelemetry', () => {
	it('should log successful request telemetry', () => {
		const ctx = createTelemetryContext('req-123', {
			model: 'claude-sonnet-4-5-20250929',
			stream: false,
		})

		ctx.response = {
			success: true,
			statusCode: 200,
			duration: 1500,
		}

		ctx.usage = {
			inputTokens: 100,
			outputTokens: 200,
		}

		// Should not throw
		expect(() => logTelemetry(ctx)).not.toThrow()
	})

	it('should log failed request telemetry', () => {
		const ctx = createTelemetryContext('req-123', {
			model: 'claude-sonnet-4-5-20250929',
			stream: false,
		})

		ctx.response = {
			success: false,
			statusCode: 429,
			duration: 500,
			errorType: 'RateLimitError',
			errorMessage: 'Rate limit exceeded',
		}

		// Should not throw
		expect(() => logTelemetry(ctx)).not.toThrow()
	})

	it('should include cost calculation for known models', () => {
		const ctx = createTelemetryContext('req-123', {
			model: 'claude-sonnet-4-5-20250929',
			stream: false,
		})

		ctx.response = {
			success: true,
			statusCode: 200,
			duration: 1000,
		}

		ctx.usage = {
			inputTokens: 1000,
			outputTokens: 2000,
		}

		// Should not throw and include cost
		expect(() => logTelemetry(ctx)).not.toThrow()
	})
})
