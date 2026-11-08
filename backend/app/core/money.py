"""Money is stored as integer minor units (piastres for EGP). Never floats."""

# Number of decimal places per currency. Adding a currency is one line.
CURRENCY_EXPONENT = {"EGP": 2, "USD": 2, "EUR": 2, "KWD": 3}


def exponent(currency: str) -> int:
    return CURRENCY_EXPONENT.get(currency.upper(), 2)


def format_money(minor: int, currency: str) -> str:
    e = exponent(currency)
    major, rest = divmod(minor, 10**e)
    return f"{major:,}.{rest:0{e}d} {currency.upper()}"
