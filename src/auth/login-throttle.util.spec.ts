import { loginThrottleTracker } from './login-throttle.util'

describe('loginThrottleTracker', () => {
	it('gives each account behind the same IP its own bucket', () => {
		const a = loginThrottleTracker({ ip: '10.0.0.1', body: { email: 'ali@x.com' } })
		const b = loginThrottleTracker({ ip: '10.0.0.1', body: { email: 'vali@x.com' } })
		expect(a).not.toBe(b)
	})

	it('keeps one bucket for the same account regardless of email case or spaces', () => {
		const a = loginThrottleTracker({ ip: '10.0.0.1', body: { email: 'Ali@X.com ' } })
		const b = loginThrottleTracker({ ip: '10.0.0.1', body: { email: 'ali@x.com' } })
		expect(a).toBe(b)
	})

	it('separates the same account used from different IPs', () => {
		const a = loginThrottleTracker({ ip: '10.0.0.1', body: { email: 'ali@x.com' } })
		const b = loginThrottleTracker({ ip: '10.0.0.2', body: { email: 'ali@x.com' } })
		expect(a).not.toBe(b)
	})

	it('does not crash on a malformed body', () => {
		expect(loginThrottleTracker({ ip: '10.0.0.1' })).toBe('10.0.0.1|')
		expect(loginThrottleTracker({ ip: '10.0.0.1', body: { email: 42 } })).toBe('10.0.0.1|')
	})
})
