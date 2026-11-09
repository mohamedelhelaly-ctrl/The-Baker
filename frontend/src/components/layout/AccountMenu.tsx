import { Link } from "react-router";
import { useAuth } from "../../lib/auth";
import { s } from "../../lib/strings";
import { Popover } from "../ui/Popover";

const item = "flex min-h-11 items-center rounded-lg px-3 font-semibold hover:bg-tint";

/** Everything about the signed-in person in one place, so the header stays short. */
export function AccountMenu({ onSignOut }: { onSignOut: () => void }) {
  const { user, can } = useAuth();
  if (!user) return null;
  const first = user.full_name.split(" ")[0] || user.full_name;
  const manage = can("catalog_admin") || can("schedule_admin") || can("settings") || can("team");
  return (
    <Popover button={first} label={`${first}, account menu`} buttonClassName="navlink" width="w-64">
      <p className="px-3 pb-2">
        <span className="block font-semibold">{user.full_name}</span>
        <span className="block break-all text-sm text-muted">{user.email}</span>
      </p>
      <ul className="border-t border-hairline pt-2">
        <li>
          <Link to="/account" className={item}>
            {s.nav.account}
          </Link>
        </li>
        <li>
          <Link to="/account/orders" className={item}>
            My orders
          </Link>
        </li>
        {can("orders_queue") && (
          <li>
            <Link to="/staff/prep-sheet" className={item}>
              Prep sheet
            </Link>
          </li>
        )}
        {manage && (
          <li>
            <Link to="/admin" className={item}>
              {s.nav.manage}
            </Link>
          </li>
        )}
      </ul>
      <button type="button" data-close onClick={onSignOut} className={`${item} mt-2 w-full border-t border-hairline pt-2 text-start`}>
        {s.nav.signOut}
      </button>
    </Popover>
  );
}
