// What every account can do: change the numbers here to change them for everyone.
// decks: Infinity means no cap on the number of presentations.
export const LIMITS = { decks: Infinity, questions: 50, voters: 3000 };

// The same limits whatever the plan stored on the account.
export const limitsOf = (_plan?: string) => LIMITS;
