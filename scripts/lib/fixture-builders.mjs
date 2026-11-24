// Builders for Shopify Function fixtures (shared by tests and the perf script).
export const C100 = "gid://shopify/Collection/100";

export function metafield({ ruleId = "rule_1", title = "10% off Winter", collectionIds = [C100], value }) {
  return {
    jsonValue: {
      schemaVersion: 1,
      ruleId,
      title,
      collectionIds,
      config: { type: "AMOUNT_OFF_PRODUCTS", target: { kind: "COLLECTIONS", collectionIds }, value },
    },
  };
}

export function line(n, { quantity = 1, amount, currencyCode = "USD", inCollection = true } = {}) {
  return {
    id: `gid://shopify/CartLine/${n}`,
    quantity,
    cost: { subtotalAmount: { amount, currencyCode } },
    merchandise: {
      __typename: "ProductVariant",
      id: `gid://shopify/ProductVariant/${n}`,
      product: { id: `gid://shopify/Product/${n}`, inAnyCollection: inCollection },
    },
  };
}

export function linesInput({ lines, metafield: mf, discountClasses = ["PRODUCT"], rate = "1.0" }) {
  return {
    presentmentCurrencyRate: rate,
    cart: { lines },
    discount: { discountClasses, metafield: mf ?? null },
  };
}

export function fixture(input, output) {
  return {
    payload: {
      export: "cart-lines-discounts-generate-run",
      target: "cart.lines.discounts.generate.run",
      input,
      output,
    },
  };
}

/** Big cart: every other line in the collection; unit price 99.99 (or JPY etc. via amountFn). */
export function bigCart(lineCount, quantity, unit = "99.99") {
  const lines = [];
  for (let i = 0; i < lineCount; i++) {
    const amount = (Number(unit) * quantity).toFixed(2);
    lines.push(line(i, { quantity, amount, inCollection: i % 2 === 0 }));
  }
  return lines;
}
