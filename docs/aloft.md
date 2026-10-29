# Aloft

Aloft is Aloysius Chow's personal fork of [Paseo](https://github.com/getpaseo/paseo),
hosted at [aloychow/aloft](https://github.com/aloychow/aloft).
It is a desktop and phone workspace for coding agents that also carries daily-life
modules, starting with Notes. Plans, specs and decisions live in the Aloft Lark wiki;
this file holds the code-level facts.

## Foundation

This fork starts from Paseo commit
`3196260bd440d56ab5b3adda3daa8afbd8a08d0d`. Keep its daemon, provider adapters,
clients, terminal implementation, and Git integration as the starting point.
Keep changes small enough to review and carry forward when pulling upstream fixes.

Paseo's [Apache 2.0 license](../LICENSE), attribution, and third-party licenses
continue to apply. The Aloft name identifies this downstream project.

## Where Aloft differs from upstream

- **Send shortcut.** Enter and Shift+Enter insert a new line; Cmd+Enter (Ctrl+Enter
  elsewhere) sends. Cmd+Shift+Enter takes the alternate send (queue or submit) while
  an agent runs. The default lives in `packages/app/src/hooks/use-settings/storage.ts`
  and the key handling in `packages/app/src/composer/input/state.ts`. The shared e2e
  fixture pins plain Enter so upstream specs keep testing upstream behaviour;
  `packages/app/e2e/browser/aloft-send-shortcut.spec.ts` covers the Aloft default.
- **Modules as plugins.** Daily-life modules live in [`aloft-plugins/`](../aloft-plugins/),
  outside upstream files. See its README for install, reload, checks and the client
  constraints. Built-in plugins in `plugins/` cannot import npm packages, so Aloft
  modules are directory plugins.

## Development

Use Node 22, as pinned in `.tool-versions`. This Mac's default Homebrew `node` is a
newer major; install Node 22 beside it and put it first on the path for repo work:

```bash
brew install node@22                           # keg-only, leaves the default node alone
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
npm install
npm run build:server                           # dist declarations the app and tests import
```

Installing `node@22` can upgrade shared Homebrew libraries such as `simdjson`. The
default `node` then fails to launch with `Library not loaded: libsimdjson.<n>.dylib`.
Run `brew upgrade node` to rebuild the link.

Follow [development.md](development.md) for the dev daemon, app and desktop, and
[testing.md](testing.md) for targeted checks. The inherited `@getpaseo/*` workspace
names, scripts, and `PASEO_*` variables stay in place to avoid churn across packages.

Start the dev daemon with `ALOFT_NOTES_DEFAULT_VAULT=<scratch folder>` while working on
Notes, so the dev build never edits the real vault in `~/Documents/Aloft Notes`.

## Git workflow

- `origin` points to `aloychow/aloft`.
- `upstream` points to `getpaseo/paseo`. Its local push URL is disabled.
- `main` carries Aloft's changes. Each change gets a feature branch.

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
