import { test, expect } from "@playwright/test";

test.describe("Home Page", () => {
  test("should display the main heading", async ({ page }) => {
    await page.goto("/");
    
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Play Together");
  });

  test("should display game cards", async ({ page }) => {
    await page.goto("/");
    
    await expect(page.getByText("Connect 4")).toBeVisible();
    await expect(page.getByText("Rock Paper Scissors")).toBeVisible();
  });

  test("should have navigation links", async ({ page }) => {
    await page.goto("/");
    
    await expect(page.getByRole("link", { name: "Lobby" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Profile" })).toBeVisible();
  });

  test("should navigate to lobby", async ({ page }) => {
    await page.goto("/");
    
    await page.getByRole("link", { name: "Find a Game" }).click();
    
    await expect(page).toHaveURL("/lobby");
    await expect(page.getByRole("heading", { name: "Game Lobby" })).toBeVisible();
  });
});

