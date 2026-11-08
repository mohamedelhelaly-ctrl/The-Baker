"""Single source of truth for who can read/write which module (DESIGN.md §3).

Guards are generated from this map and attached when routers are registered.
Guests are unauthenticated and only reach public endpoints, so they have no role here.
"""

from app.models.user import UserRole

CUSTOMER, STAFF, OWNER = UserRole.customer, UserRole.staff, UserRole.owner
ALL = {CUSTOMER, STAFF, OWNER}

PERMISSIONS: dict[str, dict[str, set[UserRole]]] = {
    "account": {"read": ALL, "write": ALL},
    "orders_queue": {"read": {STAFF, OWNER}, "write": {STAFF, OWNER}},
    "catalog_admin": {"read": {OWNER}, "write": {OWNER}},
    "schedule_admin": {"read": {STAFF, OWNER}, "write": {OWNER}},
    "settings": {"read": {OWNER}, "write": {OWNER}},
    "team": {"read": {OWNER}, "write": {OWNER}},
}


def allowed_modules(role: UserRole) -> dict[str, dict[str, bool]]:
    """What the frontend uses to hide pages. The server still enforces everything."""
    return {
        module: {"read": role in rules["read"], "write": role in rules["write"]}
        for module, rules in PERMISSIONS.items()
    }
