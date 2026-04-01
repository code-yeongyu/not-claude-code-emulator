import { describe, expect, it } from 'bun:test'
import { normalizeSseChunk, normalizeToolUseNames } from './tool-name-normalizer.js'

describe('normalizeToolUseNames', () => {
	it('converts PascalCase tool_use names to snake_case', () => {
		const input = {
			content: [
				{
					type: 'tool_use',
					name: 'ReadFile',
					input: { path: '/tmp/test.txt' },
				},
			],
		}

		const result = normalizeToolUseNames(input) as {
			content: Array<{ name: string }>
		}

		expect(result.content[0].name).toBe('read_file')
	})

	it('leaves snake_case tool_use names unchanged', () => {
		const input = {
			content: [
				{
					type: 'tool_use',
					name: 'read_file',
				},
			],
		}

		const result = normalizeToolUseNames(input) as {
			content: Array<{ name: string }>
		}

		expect(result.content[0].name).toBe('read_file')
	})
})

describe('normalizeSseChunk', () => {
	it('converts content_block_start tool_use names to snake_case', () => {
		const chunk =
			'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"ReadFile","input":{"path":"/tmp/test.txt"}}}\n\n'

		const result = normalizeSseChunk(chunk)

		expect(result).toContain('"name":"read_file"')
		expect(result).not.toContain('"name":"ReadFile"')
	})

	it('leaves non-json lines unchanged', () => {
		const chunk = 'event: ping\ndata: [DONE]\n\n'
		expect(normalizeSseChunk(chunk)).toBe(chunk)
	})
})
