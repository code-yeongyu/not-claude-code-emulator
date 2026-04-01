export const CLAUDE_AI_INFERENCE_SCOPE = 'user:inference' as const
export const CLAUDE_AI_PROFILE_SCOPE = 'user:profile' as const

const CONSOLE_SCOPE = 'org:create_api_key' as const

export const CLAUDE_AI_OAUTH_SCOPES = [
	CLAUDE_AI_PROFILE_SCOPE,
	CLAUDE_AI_INFERENCE_SCOPE,
	'user:sessions:claude_code',
	'user:mcp_servers',
	'user:file_upload',
] as const

export const CONSOLE_OAUTH_SCOPES = [CONSOLE_SCOPE, CLAUDE_AI_PROFILE_SCOPE] as const

export const ALL_OAUTH_SCOPES = Array.from(
	new Set([...CLAUDE_AI_OAUTH_SCOPES, ...CONSOLE_OAUTH_SCOPES]),
)

export interface OAuthConfig {
	baseApiUrl: string
	consoleAuthorizeUrl: string
	claudeAiAuthorizeUrl: string
	tokenUrl: string
	consoleSuccessUrl: string
	claudeAiSuccessUrl: string
	manualRedirectUrl: string
	clientId: string
}

const DEFAULT_CONFIG: OAuthConfig = {
	baseApiUrl: 'https://api.anthropic.com',
	consoleAuthorizeUrl: 'https://platform.claude.com/oauth/authorize',
	claudeAiAuthorizeUrl: 'https://claude.com/cai/oauth/authorize',
	tokenUrl: 'https://platform.claude.com/v1/oauth/token',
	consoleSuccessUrl:
		'https://platform.claude.com/buy_credits?returnUrl=/oauth/code/success%3Fapp%3Dclaude-code',
	claudeAiSuccessUrl: 'https://platform.claude.com/oauth/code/success?app=claude-code',
	manualRedirectUrl: 'https://platform.claude.com/oauth/code/callback',
	clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
}

function validateOverrideBaseUrl(baseUrl: string): string {
	const parsed = new URL(baseUrl)
	const isLocalhost =
		parsed.hostname === 'localhost' ||
		parsed.hostname === '127.0.0.1' ||
		parsed.hostname === '::1' ||
		parsed.hostname === '[::1]'

	if (parsed.protocol === 'https:') {
		return parsed.toString().replace(/\/$/, '')
	}

	if (parsed.protocol === 'http:' && isLocalhost) {
		return parsed.toString().replace(/\/$/, '')
	}

	throw new Error('ANTHROPIC_OAUTH_BASE_URL must use https or localhost http')
}

export function getOAuthConfig(): OAuthConfig {
	const overrideBaseUrl = process.env.ANTHROPIC_OAUTH_BASE_URL
		? validateOverrideBaseUrl(process.env.ANTHROPIC_OAUTH_BASE_URL)
		: undefined
	const clientId = process.env.ANTHROPIC_OAUTH_CLIENT_ID ?? DEFAULT_CONFIG.clientId

	if (!overrideBaseUrl) {
		return {
			...DEFAULT_CONFIG,
			clientId,
		}
	}

	return {
		baseApiUrl: overrideBaseUrl,
		consoleAuthorizeUrl: `${overrideBaseUrl}/oauth/authorize`,
		claudeAiAuthorizeUrl: `${overrideBaseUrl}/oauth/authorize`,
		tokenUrl: `${overrideBaseUrl}/v1/oauth/token`,
		consoleSuccessUrl: `${overrideBaseUrl}/oauth/code/success?app=claude-code`,
		claudeAiSuccessUrl: `${overrideBaseUrl}/oauth/code/success?app=claude-code`,
		manualRedirectUrl: `${overrideBaseUrl}/oauth/code/callback`,
		clientId,
	}
}
