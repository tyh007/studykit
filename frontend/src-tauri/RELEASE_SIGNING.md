# StudyKit desktop release gate

Local development and unsigned QA builds are supported by:

```sh
npm run desktop:build:unsigned
npm run desktop:bundle
npm run desktop:dmg
```

Public distribution is intentionally blocked until the release owner supplies
platform credentials:

- macOS: Apple Developer ID Application certificate and notarisation account.
- Windows: trusted code-signing certificate.
- Linux: package signing/repository credentials where the chosen channel needs them.
- Auto-update: a protected Tauri updater private key, the matching public key,
  HTTPS release endpoints, and signed update artifacts.

Do not commit private keys, passwords, or certificate exports. CI must inject
them through its secret store. `supportsAutoUpdate` remains `false` and no
updater endpoint is embedded until this gate is complete; StudyKit must never
accept an unsigned update or a placeholder key.

Before publishing a release:

1. Run the full Web and Rust suites and build the unsigned desktop binary.
2. Build signed packages on each target operating system. The local `.app`
   build is the default; DMG packaging is an explicit release-host step because
   it requires macOS disk-image/Finder services.
3. Install on a clean device, create/open a workspace, import legacy data,
   create a backup, then upgrade and reopen the same workspace.
4. Restore by opening a generated snapshot folder and verify its integrity.
5. Publish signed updater metadata only after install/upgrade/rollback checks pass.
