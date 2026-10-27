// Categories of the presentations shared in Community.
export type Category = "Team" | "Events" | "Training" | "HR";
import type { Stored } from "./questions";

export type Template = { id: string; title: string; category: Category; context: string; description: string; questions: Stored[]; createdAt?: number };

export const CATEGORIES: Category[] = ["Team", "Events", "Training", "HR"];
