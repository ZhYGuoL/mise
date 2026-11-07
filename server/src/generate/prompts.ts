import type { Concept, MenuItem } from "@mise/shared";
import { describeColor } from "./colors";

const cuisineWords = (concept: Concept) => concept.cuisine.map((c) => c.replaceAll("_", " ")).join(", ");

/**
 * One house style for every dish, so the menu looks like one restaurant shot it in one session:
 * same backdrop, same light, same angle, same packaging. Only the brand colors and the dish change.
 * The restaurant name is not in the prompt, so a rename does not make every photo again.
 */
export function dishPrompt(concept: Concept, item: MenuItem): string {
  const { primary, background } = concept.brand.colors;
  const subject = item.imagePrompt?.trim() || `${item.name}. ${item.description}`;
  return [
    "Professional food photograph for a delivery app menu.",
    `Subject: ${subject}`,
    `Cuisine: ${cuisineWords(concept)}.`,
    "",
    "House style. Every photo on this menu uses it exactly, so the whole menu matches:",
    "- Camera: flat lay, looking straight down at exactly 90 degrees. No perspective, no tilt, no visible sides of the packaging. Open packaging, so the food is the hero.",
    "- Framing: centered. The food and its packaging fill about 80% of the frame.",
    `- Backdrop: one flat, seamless, matte paper surface in ${describeColor(background)}. No table, no wood grain, no cloth, no texture.`,
    "- Light: soft window daylight from the top left. One soft, short shadow falls to the bottom right.",
    `- Packaging: plain kraft-brown paper takeout packaging (box, bowl or cup, as the dish needs) with one small solid ${describeColor(primary)} round sticker. No printing, words or logos on anything.`,
    "- Color: true to life and appetizing. Not oversaturated, no filters.",
    "- Nothing else in frame: no hands, no people, no extra props, no scattered garnish, no text.",
    "Photorealistic.",
  ].join("\n");
}

/** Flat two-color mark. The rule from Zhiyuan: the best marks fuse two ideas into one form, and never caption the trick. */
export function logoPrompt(concept: Concept): string {
  const { primary, background } = concept.brand.colors;
  const initial = concept.name.trim().charAt(0).toUpperCase();
  return [
    `Logo mark for a restaurant called "${concept.name}".`,
    `What it is: ${concept.tagline} Cuisine: ${cuisineWords(concept)}.`,
    concept.brand.logoPrompt ? `Owner's note: ${concept.brand.logoPrompt}.` : "",
    "",
    "Design rules:",
    "- One simple, bold symbol. Flat vector graphic, centered. The symbol fills about 70% of the square.",
    `- Exactly two colors: the symbol in ${describeColor(primary)}, on a solid ${describeColor(background)} background that fills the whole square.`,
    "- No gradients, no shadows, no outlines in a third color, no texture, no 3D, no mockup, no frame.",
    `- The symbol fuses two ideas into one form, the way the FedEx logo hides an arrow in the space between the E and the x. Take one idea from the food and one from the name, and draw a single shape that reads as both at once. Use negative space. You may build it from the letter ${initial}.`,
    "- It must read clearly when it is 32 pixels wide.",
    "- No words, no letters other than the optional initial, no tagline, no caption, no labels that explain the idea.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
