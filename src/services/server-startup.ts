import { AuthenticationError, resolveOAuthToken, verifyOAuthToken } from './oauth-client.js'

const SERVER_STARTUP_ERROR =
	'No valid OAuth token configured. Set ANTHROPIC_OAUTH_TOKEN or run `bun run cli login` or `bun run cli setup-token` before starting the server.'
const SERVER_STARTUP_INVALID_TOKEN_ERROR =
	'Configured OAuth token is invalid or expired. Run `bun run cli login` or `bun run cli setup-token` to refresh it before starting the server.'

export async function ensureServerStartupAuth(): Promise<string> {
	try {
		const token = await resolveOAuthToken()
		const tokenInfo = await verifyOAuthToken(token)
		if (!tokenInfo.isValid) {
			throw new Error(SERVER_STARTUP_INVALID_TOKEN_ERROR)
		}
		return token
	} catch (error) {
		if (error instanceof AuthenticationError) {
			throw new Error(SERVER_STARTUP_ERROR)
		}

		throw error
	}
}

export { SERVER_STARTUP_ERROR, SERVER_STARTUP_INVALID_TOKEN_ERROR }
