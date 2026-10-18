import { type ComponentProps, useId } from "react";
import { Icon, type IconName } from "./icons";

type Props = Omit<ComponentProps<"button">, "children"> & {
  title: string;
  subtitle: string;
  icon: IconName;
};

/** A tool launcher in the assistant card: icon, title, one-line description, chevron. The
 * accessible name is the title alone; the description is announced as the description. */
export function LaunchRow({ title, subtitle, icon, className = "", ...rest }: Props) {
  const sub = useId();
  return (
    <button
      type="button"
      aria-label={title}
      aria-describedby={sub}
      className={`group flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-fg/5 ${className}`}
      {...rest}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-full border border-edge bg-raised text-fg-soft transition-colors group-hover:text-fg">
        <Icon name={icon} className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-fg">{title}</span>
        <span id={sub} className="block truncate text-xs text-fg-soft">
          {subtitle}
        </span>
      </span>
      <Icon name="chevron" className="size-4 text-fg-soft" />
    </button>
  );
}
