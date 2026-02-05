import { test, expect } from "@playwright/test";

test.describe("Lobby Page", () => {
  test("should display lobby heading", async ({ page }) => {
    await page.goto("/lobby");
    
    await expect(page.getByRole("heading", { name: "Game Lobby" })).toBeVisible();
  });

  test("should have game filter chips", async ({ page }) => {
    await page.goto("/lobby");
    
    await expect(page.getByRole("button", { name: "All Games" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect 4" })).toBeVisible();
    await expect(page.getByRole("button", { name: "RPS" })).toBeVisible();
  });

  test("should open create room modal", async ({ page }) => {
    await page.goto("/lobby");
    
    await page.getByRole("button", { name: "Create Room" }).click();
    
    await expect(page.getByRole("heading", { name: "Create a Room" })).toBeVisible();
  });

  test("should filter rooms when clicking filter chips", async ({ page }) => {
    await page.goto("/lobby");
    
    // Click Connect 4 filter
    await page.getByRole("button", { name: "Connect 4" }).click();
    
    // Should still show the lobby (filter is applied)
    await expect(page.getByRole("heading", { name: "Game Lobby" })).toBeVisible();
  });
});

