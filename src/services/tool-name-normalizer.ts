function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPurePascalCase(name: string): boolean {
	if (!/^[A-Z]/.test(name)) return false
	if (name.includes('_')) return false
	if (/[A-Z]{2}/.test(name)) return false
	return true
}

function fromPascalCase(name: string): string {
	return name
		.replace(/([A-Z])/g, '_$1')
		.toLowerCase()
		.replace(/^_/, '')
}

export function normalizeToolUseNames(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(normalizeToolUseNames)
	}

	if (!isPlainObject(value)) {
		return value
	}

	const next: Record<string, unknown> = {}
	for (const [key, child] of Object.entries(value)) {
		next[key] = normalizeToolUseNames(child)
	}

	if (next.type === 'tool_use' && typeof next.name === 'string' && isPurePascalCase(next.name)) {
		next.name = fromPascalCase(next.name)
	}

	return next
}

export function normalizeSseChunk(chunk: string): string {
	const events = chunk.split('\n\n')
	const normalizedEvents = events.map((eventText) => {
		if (!eventText.trim()) return eventText

		const lines = eventText.split('\n')
		const normalizedLines = lines.map((line) => {
			if (!line.startsWith('data:')) return line
			const raw = line.slice(5).trim()
			if (!raw.startsWith('{') || !raw.endsWith('}')) return line

			try {
				const parsed = JSON.parse(raw) as unknown
				const normalized = normalizeToolUseNames(parsed)
				return `data: ${JSON.stringify(normalized)}`
			} catch {
				return line
			}
		})

		return normalizedLines.join('\n')
	})

	return normalizedEvents.join('\n\n')
}
