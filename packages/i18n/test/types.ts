import { Decimal } from "decimal.js";
import { formatMoney, formatPrice, formatQuantity } from "../src/formatters.js";

formatMoney("1.005", "PLN");
formatMoney(new Decimal("1.005"), "USD");
// @ts-expect-error Money must never enter the formatter as a float.
formatMoney(1.005, "PLN");
// @ts-expect-error Currency is mandatory.
formatMoney("1.005");
// @ts-expect-error Quotes also preserve decimal input.
formatPrice(1.005, "PLN", 2);
// @ts-expect-error Fractional quantities must preserve decimal input.
formatQuantity(0.1);
