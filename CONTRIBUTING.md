# Contributing

Issues and pull requests are welcome.

- For a bug, say what you did, what you expected and what happened.
- For a bigger change, open an issue first so we can agree on the approach.
- Keep the interface simple and the texts short. No em dashes in any text shown to people.
- Every text shown to people needs its French (`src/i18n/`). Texts on phones and on the big screen also need Spanish, German, Italian and Portuguese (`src/ui-translations.ts`, `src/screen-translations.ts`). `npm run check` lists what is missing.
- Run `npm run check` before opening a pull request, and `npm test` when your change touches the API or the live rooms (see the readme).

By sending a contribution, you agree that it is published under the AGPL-3.0, the license of this repository, and you grant the Hopvote maintainers a perpetual, worldwide, non-exclusive, royalty-free license to use, change and relicense it under other terms.
