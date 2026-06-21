# Security Policy

## Reporting a Vulnerability

Please **do not** open a public issue for security problems.

Report vulnerabilities privately through GitHub's
[**Report a vulnerability**](https://github.com/youngsanifone/snake/security/advisories/new)
form (Security → Advisories → Report a vulnerability).

You can expect an initial response within a few days. Once a fix is ready,
the report will be disclosed responsibly.

## Scope

This is a client-side HTML5 game. Relevant concerns include:

- Cross-site scripting (XSS) in the game UI or leaderboard
- Issues that let a player tamper with another player's profile or score
- Leaks of private data through the public API

Out of scope: anything requiring physical access to a user's device, or
self-XSS that only affects the reporter's own browser.
