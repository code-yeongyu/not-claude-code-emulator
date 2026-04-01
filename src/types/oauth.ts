export interface OAuthTokens {
	accessToken: string
	refreshToken: string | null
	expiresAt: number | null
	scopes: string[]
}

export interface OAuthAccountInfo {
	uuid: string
	email_address: string
}

export interface OAuthOrganizationInfo {
	uuid: string
}

export interface OAuthTokenExchangeResponse {
	access_token: string
	refresh_token?: string
	expires_in: number
	scope?: string
	account?: OAuthAccountInfo
	organization?: OAuthOrganizationInfo
}
