# Security Guidelines

This document outlines security measures implemented in the IBMS application and best practices for developers.

## Implemented Security Measures

### 1. Authentication & Authorization

- **JWT-based authentication**: Access tokens are short-lived (15 minutes)
- **Refresh token rotation**: Tokens are rotated on refresh
- **Secure cookie storage**: Refresh tokens stored in `httpOnly`, `secure`, `sameSite=strict` cookies
- **MFA enforcement**: Multi-factor authentication (TOTP) required for sensitive operations
- **Role-Based Access Control (RBAC)**: Fine-grained permission checks on all endpoints
- **Session validation**: Every access token request validates the session state

### 2. Transport Security

- **Mandatory TLS**: In production, all traffic must be over HTTPS
- **HSTS header**: Strict-Transport-Security with 1-year max-age
- **TLS database connection**: DATABASE_URL must use sslmode=require in production
- **Secure cookies in production**: Secure flag set only when NODE_ENV=production

### 3. Input Validation & Sanitization

- **Request validation**: NestJS ValidationPipe with whitelist/forbidNonWhitelisted
- **Type checking**: Full TypeScript coverage prevents type-related vulnerabilities
- **DTOs**: All inputs validated against class-validator schemas
- **Sanitization utilities**: Available in `common/sanitization.util.ts` for special cases

### 4. Output Encoding & XSS Prevention

- **No dangerouslySetInnerHTML**: Avoided in React components
- **HTML escaping**: All dynamic content escaped before rendering
- **CSP header**: Content-Security-Policy restricts inline scripts
- **X-XSS-Protection header**: Enables browser XSS protection

### 5. SQL Injection Prevention

- **Prisma ORM**: Parameterized queries prevent SQL injection
- **No raw SQL**: Avoided whenever possible; when used, only via Prisma.sql() with parameters
- **Prepared statements**: All database queries use prepared statements

### 6. CSRF Protection

- **Same-site cookies**: Refresh tokens use sameSite=strict
- **CORS configuration**: Strict origin validation
- **Token in httpOnly cookie**: CSRF tokens cannot be read by JavaScript

### 7. Rate Limiting

- **Login rate limiting**: 5 attempts per 15 minutes per IP
- **Password reset rate limiting**: 3 attempts per hour per IP
- **MFA verification rate limiting**: 10 attempts per 15 minutes per IP
- **In-memory store**: Per-IP rate limit tracking (Redis recommended for production)

### 8. Sensitive Data Protection

- **Field-level encryption**: Highly Confidential data (national IDs, emails, phones) encrypted at rest
- **PII encryption**: Sensitive personal information encrypted with AES-256-GCM
- **Log redaction**: Sensitive fields redacted from all logs:
  - Authorization headers
  - Cookies (Set-Cookie)
  - Passwords and password hashes
  - Tokens (access, refresh, MFA)
  - Secrets
  - Encrypted fields
- **No request/response body logging**: Bodies never serialized in operational logs

### 9. Security Headers

The following security headers are set on all responses:

```
X-Content-Type-Options: nosniff           # Prevents MIME sniffing
X-Frame-Options: DENY                     # Prevents clickjacking
X-XSS-Protection: 1; mode=block           # Browser XSS protection
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: default-src 'none'; script-src 'self'
Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=(), usb=()
Strict-Transport-Security: max-age=31536000 (production only)
```

### 10. Error Handling

- **Generic error messages**: Sensitive implementation details not exposed to clients
- **Error logging**: Full error details logged server-side only
- **Stack traces**: Only shown in development (NODE_ENV != production)

### 11. Dependency Security

- **npm audit**: Run `npm test:security` to check for known vulnerabilities
- **Regular updates**: Dependencies updated regularly
- **Audit fix**: Use `npm audit fix` to auto-patch known vulnerabilities

### 12. Environment Security

- **Environment variables**: Sensitive config never committed to git
- `.env` files: Use `.env.example` as template
- **Validation at startup**: JWT_ACCESS_SECRET and DATABASE_URL validated in production

## Security Best Practices for Developers

### Do's

✅ **Use parameterized queries** with Prisma
```typescript
// Good
const user = await prisma.user.findUnique({ where: { id: userId } });
const custom = await prisma.$queryRaw`SELECT * FROM users WHERE id = ${userId}`;
```

✅ **Validate all inputs** using DTOs
```typescript
export class CreateUserDto {
  @IsEmail()
  email!: string;
  
  @IsString()
  @MinLength(8)
  password!: string;
}
```

✅ **Encrypt sensitive data** using EncryptionService
```typescript
const encrypted = await encryptionService.encrypt(nationalId);
```

✅ **Use rate limiting** on sensitive endpoints
```typescript
@Post('login')
@AuthRateLimit()
async login(@Body() dto: LoginDto) { ... }
```

✅ **Sanitize output** if it will be rendered as HTML
```typescript
const safe = escapeHtml(userInput);
```

✅ **Log security events** to the audit trail
```typescript
await auditService.log({
  action: 'USER_LOGIN',
  entityId: userId,
  changes: { ipAddress },
});
```

### Don'ts

❌ **Never log sensitive data**
```typescript
// Bad
logger.info({ password, creditCard }); // Automatically redacted, but still bad practice
```

❌ **Never concatenate SQL strings**
```typescript
// Bad - SQL Injection risk
const query = `SELECT * FROM users WHERE email = '${email}'`;
```

❌ **Never trust user input without validation**
```typescript
// Bad
const user = await prisma.user.findUnique({ where: { id: req.body.id } });

// Good
const { id } = new CreateUserDto(); // Validates after class-transformer
const user = await prisma.user.findUnique({ where: { id } });
```

❌ **Never bypass CORS/authentication**
```typescript
// Bad
@Post('sensitive-data')
@Public() // Don't use unless absolutely necessary
```

❌ **Never store secrets in code**
```typescript
// Bad
const apiKey = 'sk_live_12345';

// Good
const apiKey = process.env.STRIPE_API_KEY;
```

❌ **Never expose stack traces in production**
```typescript
// Bad - middleware catches and logs everything
app.use((error, req, res, next) => {
  res.json({ error: error.stack }); // Exposes internals
});

// Good
app.use((error, req, res, next) => {
  logger.error(error); // Logged server-side only
  res.status(500).json({ message: 'Internal server error' });
});
```

## Security Testing

### Run Security Audit
```bash
npm run test:security  # npm audit --audit-level=high
```

### Check for Vulnerable Dependencies
```bash
npm audit
npm audit fix  # Auto-fix available vulnerabilities
```

### Manual Security Review
- Review authentication flows
- Verify rate limiting on sensitive endpoints
- Check for hardcoded secrets
- Verify CORS configuration
- Test RBAC enforcement

## Incident Response

If a security vulnerability is discovered:

1. **Do not commit or push** the fix
2. **Document the vulnerability** with severity level
3. **Create a private security branch** off main
4. **Fix and test** the vulnerability
5. **Request a security code review** before merging
6. **Update SECURITY.md** with lessons learned

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [OWASP API Security](https://owasp.org/www-project-api-security/)
- [NestJS Security Documentation](https://docs.nestjs.com/security/overview)
- [PDPL No. 24/2023](./ibms-brain/meta/context/pcms-privacy-modules.md)

## Contact

For security concerns, contact the security team or submit a security report through the appropriate channels (do not open public issues for vulnerabilities).
