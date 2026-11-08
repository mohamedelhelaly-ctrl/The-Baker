from app.config import get_settings
from app.services.payments.base import PaymentProvider


def get_payment_provider() -> PaymentProvider | None:
    """The configured provider, or None when online payment is not set up."""
    name = get_settings().payment_provider
    if name == "paymob":
        from app.services.payments.paymob_provider import PaymobProvider

        return PaymobProvider()
    if name == "fake":
        from app.services.payments.fake_provider import FakeProvider

        return FakeProvider()
    return None
