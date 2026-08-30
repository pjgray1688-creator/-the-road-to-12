export type UserProfile = { id: string; email: string; displayName?: string; timezone: string; stepGoal: number; createdAt: string; goals: string[] };
export type ActivitySource = "apple_health" | "whoop" | "manual";
export type DailyActivity = { userId: string; date: string; source: ActivitySource; steps?: number; activeCalories?: number; strain?: number; updatedAt: string };
export type NutritionTarget = { userId: string; calories?: number; protein?: number; carbohydrates?: number; fats?: number };
export type Food = { id: string; userId: string; name: string; calories?: number; protein?: number; carbohydrates?: number; fats?: number; source: "user" | "provider" };
export type Meal = { id: string; userId: string; name: string; timing?: string; foods: string[] };
export type FoodLog = { id: string; userId: string; date: string; mealId?: string; foodId: string; servings: number };
export type MealPlan = { id: string; userId: string; name: string; meals: string[] };
export type ShoppingList = { id: string; userId: string; name: string; items: string[] };
export const defaultStepGoal = 10000;
export function ownedBy<T extends { userId: string }>(record: T, userId: string) { return record.userId === userId; }
export function assertOwnership<T extends { userId: string }>(record: T | undefined, userId: string) { if (!record || record.userId !== userId) throw new Error("Not found"); return record; }
