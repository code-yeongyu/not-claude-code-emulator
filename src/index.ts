/**
 * Main server entry point
 */

import { OpenAPIHono } from '@hono/zod-openapi'
import { apiReference } from '@scalar/hono-api-reference'
import { serve } from 'bun'
import { openApiConfig } from './config/openapi.js'
import { messagesRoute } from './routes/messages.js'
import { ensureServerStartupAuth } from './services/server-startup.js'

const app = new OpenAPIHono()

// Mount routes
app.route('/', messagesRoute)

// OpenAPI documentation endpoint
app.get('/openapi.json', (c) => {
	return c.json(app.getOpenAPI31Document(openApiConfig))
})

// Scalar API Reference UI
app.get(
	'/docs',
	apiReference({
		theme: 'kepler',
		spec: {
			url: '/openapi.json',
		},
	}),
)

// Root redirect to docs
app.get('/', (c) => {
	return c.redirect('/docs')
})

const PORT = Number.parseInt(process.env.PORT ?? '3000', 10)
const HOST = process.env.HOST ?? 'localhost'

async function startServer(): Promise<void> {
	await ensureServerStartupAuth()

	console.log(`🚀 Starting not-claude-code-emulator...`)
	console.log(`📚 Documentation: http://${HOST}:${PORT}/docs`)
	console.log(`📖 OpenAPI Spec: http://${HOST}:${PORT}/openapi.json`)
	console.log(`🏥 Health Check: http://${HOST}:${PORT}/health`)
	console.log(`💬 Messages API: http://${HOST}:${PORT}/v1/messages`)

	serve({
		fetch: app.fetch,
		port: PORT,
		hostname: HOST,
	})

	console.log(`✅ Server running at http://${HOST}:${PORT}`)
}

await startServer().catch((error) => {
	console.error(`❌ ${error instanceof Error ? error.message : String(error)}`)
	process.exit(1)
})

export { app }
