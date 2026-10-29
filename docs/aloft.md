# Aloft

Aloft is Aloysius Chow's personal fork of [Paseo](https://github.com/getpaseo/paseo),
hosted at [aloychow/aloft](https://github.com/aloychow/aloft).
Its focus is a desktop workspace for coding agents, projects, terminals, and diffs
that can be adjusted to personal preferences.

## Foundation

This fork starts from Paseo commit
`3196260bd440d56ab5b3adda3daa8afbd8a08d0d`. Keep its daemon, provider adapters,
clients, terminal implementation, and Git integration as the starting point.
Keep changes small enough to review and carry forward when pulling upstream fixes.

Paseo's [Apache 2.0 license](../LICENSE), attribution, and third-party licenses
continue to apply. The Aloft name identifies this downstream project.

## Preferences

Start with these desktop preferences:

- Enter inserts a new line in chat.
- Command+Enter sends a message on macOS. Control+Enter serves the same purpose
  on other platforms.
- Everyday interaction choices remain configurable in settings.

The starting source already provides a send-shortcut preference in
`packages/app/src/screens/settings/general/sending-section.tsx`. Reuse that
preference when changing defaults. The initial Aloft setup does not change app
behavior or packaged app branding.

## Development

Follow [development.md](development.md) for prerequisites, dependency installation,
and desktop development. Follow [testing.md](testing.md) for targeted checks.
The inherited `@getpaseo/*` workspace names, scripts, and `PASEO_*` variables stay
in place to avoid unnecessary changes across packages.

## Git workflow

- `origin` points to `aloychow/aloft`.
- `upstream` points to `getpaseo/paseo`. Its local push URL is disabled.
- `main` carries Aloft's changes. Use feature branches for later customizations.

To pull in upstream changes, start from a clean working tree:

```bash
git fetch upstream main
git switch main
git merge upstream/main
```

Resolve conflicts, run checks appropriate to the changed packages, then push to
the personal fork. The initial local checkout contains a shallow copy of upstream
history; fetch older history only when needed.

Packaged Aloft identity, its update feed, and release automation need a separate
change before distributing Aloft builds. Upstream release commands still target
Paseo.
