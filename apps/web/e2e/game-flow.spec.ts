import { test, expect } from "@playwright/test";

test.describe("Game Flow", () => {
  test("should navigate from home to lobby", async ({ page }) => {
    await page.goto("/");
    
    // Click Find a Game button
    await page.getByRole("link", { name: "Find a Game" }).click();
    
    await expect(page).toHaveURL("/lobby");
    await expect(page.getByRole("heading", { name: "Game Lobby" })).toBeVisible();
  });

  test("should open create room modal", async ({ page }) => {
    await page.goto("/lobby");
    
    // Click Create Room button
    await page.getByRole("button", { name: "Create Room" }).click();
    
    // Modal should appear
    await expect(page.getByRole("heading", { name: "Create a Room" })).toBeVisible();
    
    // Should show game options
    await expect(page.getByText("Connect 4")).toBeVisible();
    await expect(page.getByText("Rock Paper Scissors")).toBeVisible();
  });

  test("should select game and show mode options", async ({ page }) => {
    await page.goto("/lobby");
    
    await page.getByRole("button", { name: "Create Room" }).click();
    
    // Click Connect 4
    await page.getByText("Connect 4").first().click();
    
    // Should show mode selection
    await expect(page.getByText("Play vs Human")).toBeVisible();
    await expect(page.getByText("Play vs Bot")).toBeVisible();
  });

  test("should show difficulty options when selecting bot mode", async ({ page }) => {
    await page.goto("/lobby");
    
    await page.getByRole("button", { name: "Create Room" }).click();
    await page.getByText("Connect 4").first().click();
    
    // Select bot mode
    await page.getByText("Play vs Bot").click();
    
    // Should show difficulty options
    await expect(page.getByRole("button", { name: "easy" })).toBeVisible();
    await expect(page.getByRole("button", { name: "medium" })).toBeVisible();
    await expect(page.getByRole("button", { name: "hard" })).toBeVisible();
  });

  test("should filter rooms by game type", async ({ page }) => {
    await page.goto("/lobby");
    
    // Click Connect 4 filter
    await page.getByRole("button", { name: "Connect 4" }).first().click();
    
    // Page should still be visible
    await expect(page.getByRole("heading", { name: "Game Lobby" })).toBeVisible();
  });

  test("should show all game types in filters", async ({ page }) => {
    await page.goto("/lobby");
    
    await expect(page.getByRole("button", { name: "All Games" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect 4" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "RPS" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Quoridor" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sequence" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Catan" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Splendor" })).toBeVisible();
  });

  test("should show Catan in create room modal", async ({ page }) => {
    await page.goto("/lobby");
    
    await page.getByRole("button", { name: "Create Room" }).click();
    
    await expect(page.getByText("Catan")).toBeVisible();
  });

  test("should show Splendor in create room modal", async ({ page }) => {
    await page.goto("/lobby");
    
    await page.getByRole("button", { name: "Create Room" }).click();
    
    await expect(page.getByText("Splendor")).toBeVisible();
  });
});

test.describe("Profile Page", () => {
  test("should display profile information", async ({ page }) => {
    await page.goto("/profile");
    
    // Should show guest account info
    await expect(page.getByText("Guest Account")).toBeVisible();
    
    // Should show create account button
    await expect(page.getByRole("button", { name: "Create Account" })).toBeVisible();
  });

  test("should show game stats", async ({ page }) => {
    await page.goto("/profile");
    
    // Should show stats sections
    await expect(page.getByText("Connect 4")).toBeVisible();
    await expect(page.getByText("Rock Paper Scissors")).toBeVisible();
  });
});

test.describe("Home Page Games", () => {
  test("should show all six games", async ({ page }) => {
    await page.goto("/");
    
    await expect(page.getByText("Connect 4")).toBeVisible();
    await expect(page.getByText("Rock Paper Scissors")).toBeVisible();
    await expect(page.getByText("Quoridor")).toBeVisible();
    await expect(page.getByText("Sequence")).toBeVisible();
    await expect(page.getByText("Settlers of Catan")).toBeVisible();
    await expect(page.getByText("Splendor")).toBeVisible();
  });

  test("should link to lobby from game cards", async ({ page }) => {
    await page.goto("/");
    
    // Click on Connect 4 card (it links to lobby with game filter)
    await page.locator("a[href*='lobby?game=connect4']").click();
    
    await expect(page).toHaveURL(/lobby.*game=connect4/);
  });

  test("should link to Catan lobby", async ({ page }) => {
    await page.goto("/");
    
    await page.locator("a[href*='lobby?game=catan']").click();
    
    await expect(page).toHaveURL(/lobby.*game=catan/);
  });

  test("should link to Splendor lobby", async ({ page }) => {
    await page.goto("/");
    
    await page.locator("a[href*='lobby?game=splendor']").click();
    
    await expect(page).toHaveURL(/lobby.*game=splendor/);
  });
});

