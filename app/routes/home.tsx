import { redirect } from "react-router";

// The Studio is this app's home; keep /home working for existing links.
export function loader() {
  return redirect("/studio");
}

export default function HomeRoute() {
  return null;
}

export function meta() {
  return [{ title: "Trust Contract Studio" }];
}
