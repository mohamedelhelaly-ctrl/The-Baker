// A message can be written on cakes only (not cupcakes, bread or pastries).
// Mirrors `takes_inscription` in backend/app/services/pricing.py, which is the rule that counts.
const CAKE = /\bcakes?\b/i;
export const takesInscription = (productName: string, categoryName: string) => CAKE.test(productName) || CAKE.test(categoryName);
