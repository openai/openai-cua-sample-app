# Third-party notices

`chromium-seccomp.json` is derived from Microsoft Playwright's Docker seccomp
profile at version 1.62.0, licensed under Apache License 2.0. The modification
adds permission for Chromium's `chroot` syscall inside its user namespace.

- Source: https://github.com/microsoft/playwright/blob/v1.62.0/utils/docker/seccomp_profile.json
- License: [Apache License 2.0](LICENSE.playwright)

Playwright and the packages installed in the images retain their respective
licenses in the installed distributions.
