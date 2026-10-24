"use strict";

// Use the local sprite, without loading the app or calling any API.
fetch("_sprite.html").then((response) => {
  if (!response.ok) throw new Error("Icon sprite unavailable");
  return response.text();
}).then((sprite) => document.body.insertAdjacentHTML("afterbegin", sprite))
  .catch(() => { $("#feedback").textContent = "Icon sprite unavailable. Serve static/ over HTTP to preview icons."; });

$("#buttons").innerHTML = [
  buttonHtml("Add game", { id: "exampleAdd" }),
  buttonHtml("Cancel", { variant: "ghost" }),
  buttonHtml("Delete", { variant: "danger" }),
  buttonHtml("Saving…", { disabled: true }),
].join("");
$("#chips").innerHTML = chips(["Adventure", "Puzzle", 2026]) + '<span class="pill">Completed</span>';
$("#empty").innerHTML = emptyState("No games match", "Try clearing a filter or changing your search.", "Clear filters");
$("#passive").innerHTML = emptyState("No saved games", "Save a game to see it here.");
$("#buttons").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (button) $("#feedback").textContent = `Demo action: ${button.textContent}`;
});
$("#emptyAction").addEventListener("click", () => { $("#feedback").textContent = "Demo filters cleared."; });
$("#themeToggle").addEventListener("click", (event) => {
  const light = document.documentElement.dataset.theme !== "light";
  document.documentElement.dataset.theme = light ? "light" : "dark";
  event.currentTarget.setAttribute("aria-pressed", String(light));
});
