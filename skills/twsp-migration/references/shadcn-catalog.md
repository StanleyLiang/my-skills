# shadcn/ui primitive catalog (offline)

Used by `build-shadcn-mapping.mjs` as the candidate set when matching in-house components to shadcn primitives. Each entry lists the import name, common props, and the CLI add command.

## Inputs / form

| Primitive | CLI | Key props |
|---|---|---|
| Button | `npx shadcn@latest add button` | `variant: 'default'\|'destructive'\|'outline'\|'secondary'\|'ghost'\|'link'`, `size: 'default'\|'sm'\|'lg'\|'icon'`, `asChild`, `disabled` |
| Input | `npx shadcn@latest add input` | `type`, `disabled`, all native `<input>` props |
| Textarea | `npx shadcn@latest add textarea` | `disabled`, native `<textarea>` |
| Label | `npx shadcn@latest add label` | `htmlFor` |
| Checkbox | `npx shadcn@latest add checkbox` | `checked`, `onCheckedChange`, `disabled`, `defaultChecked` |
| RadioGroup, RadioGroupItem | `npx shadcn@latest add radio-group` | `value`, `onValueChange`, item: `value` |
| Switch | `npx shadcn@latest add switch` | `checked`, `onCheckedChange`, `disabled` |
| Select, SelectTrigger, SelectContent, SelectItem | `npx shadcn@latest add select` | `value`, `onValueChange`, item: `value` |
| Form (react-hook-form integration) | `npx shadcn@latest add form` | composes with `useForm` |
| Combobox (composed from Command + Popover) | `npx shadcn@latest add command popover` | manual composition |

## Overlays

| Primitive | CLI | Key props |
|---|---|---|
| Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger, DialogClose | `npx shadcn@latest add dialog` | `open`, `onOpenChange` |
| AlertDialog (variants of Dialog) | `npx shadcn@latest add alert-dialog` | same shape |
| Sheet (slide-in side panel) | `npx shadcn@latest add sheet` | `side: 'left'\|'right'\|'top'\|'bottom'` |
| Popover, PopoverTrigger, PopoverContent | `npx shadcn@latest add popover` | `open`, `onOpenChange`, `align`, `side` |
| Tooltip, TooltipProvider, TooltipTrigger, TooltipContent | `npx shadcn@latest add tooltip` | `delayDuration` on provider |
| HoverCard | `npx shadcn@latest add hover-card` | `openDelay`, `closeDelay` |
| DropdownMenu (+ items, sub, separator, label, shortcut) | `npx shadcn@latest add dropdown-menu` | `open`, `onOpenChange` |
| ContextMenu | `npx shadcn@latest add context-menu` | wraps target |
| Menubar | `npx shadcn@latest add menubar` | composed |
| Toast (legacy) / Sonner (current) | `npx shadcn@latest add sonner` | `toast()` function |
| Drawer | `npx shadcn@latest add drawer` | mobile-first sheet variant |

## Layout / structure

| Primitive | CLI | Key props |
|---|---|---|
| Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter | `npx shadcn@latest add card` | structural |
| Separator | `npx shadcn@latest add separator` | `orientation: 'horizontal'\|'vertical'`, `decorative` |
| ScrollArea | `npx shadcn@latest add scroll-area` | wraps content |
| Tabs, TabsList, TabsTrigger, TabsContent | `npx shadcn@latest add tabs` | `value`, `onValueChange`, `defaultValue` |
| Accordion, AccordionItem, AccordionTrigger, AccordionContent | `npx shadcn@latest add accordion` | `type: 'single'\|'multiple'`, `collapsible` |
| Collapsible | `npx shadcn@latest add collapsible` | `open`, `onOpenChange` |
| Resizable (panels + handle) | `npx shadcn@latest add resizable` | `direction` |
| AspectRatio | `npx shadcn@latest add aspect-ratio` | `ratio` |

## Display / feedback

| Primitive | CLI | Key props |
|---|---|---|
| Avatar, AvatarImage, AvatarFallback | `npx shadcn@latest add avatar` | `src`, `alt` |
| Badge | `npx shadcn@latest add badge` | `variant: 'default'\|'secondary'\|'destructive'\|'outline'` |
| Skeleton | `npx shadcn@latest add skeleton` | className-only |
| Progress | `npx shadcn@latest add progress` | `value` |
| Slider | `npx shadcn@latest add slider` | `value`, `onValueChange`, `min`, `max`, `step` |
| Toggle, ToggleGroup | `npx shadcn@latest add toggle toggle-group` | `pressed`, `onPressedChange` |
| Calendar | `npx shadcn@latest add calendar` | `mode`, `selected`, `onSelect` |
| DatePicker (composed Calendar + Popover) | manual | composition |

## Data display

| Primitive | CLI | Key props |
|---|---|---|
| Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption | `npx shadcn@latest add table` | structural |
| Pagination | `npx shadcn@latest add pagination` | composed |
| Command (cmdk wrapper) | `npx shadcn@latest add command` | `value`, `onValueChange` |

## Navigation

| Primitive | CLI | Key props |
|---|---|---|
| NavigationMenu | `npx shadcn@latest add navigation-menu` | composed |
| Breadcrumb | `npx shadcn@latest add breadcrumb` | structural |
| Sidebar | `npx shadcn@latest add sidebar` | composed; needs `SidebarProvider` |

## Mapping heuristics (used by `build-shadcn-mapping.mjs`)

When the in-house spec has a component called X, search for shadcn primitives whose name OR alias matches X:

- "Btn", "Button", "PrimaryButton", "ActionButton" → `Button`
- "TextField", "TextInput", "Input" → `Input`
- "Modal", "Dialog", "Drawer" → `Dialog` (or `Sheet` if "Drawer")
- "Dropdown", "Menu", "Select" → `Select` if value-bound, `DropdownMenu` if action-bound
- "Tabs", "TabBar", "TabPanel" → `Tabs`
- "Tooltip", "Hint" → `Tooltip`
- "Card", "Panel", "Tile" → `Card`
- "Toast", "Notification", "Snackbar" → `Sonner` (preferred) or `Toast`
- "Badge", "Tag", "Chip" → `Badge`
- "Avatar", "ProfilePic" → `Avatar`
- "Spinner", "Loader" → use Tailwind animation; not a shadcn primitive
- "Pagination" → `Pagination`
- "DataTable", "Table", "Grid" → `Table` for simple cases; STOP for virtualized/sortable grids (no exact shadcn equivalent — needs TanStack Table composition)

## Things NOT covered by shadcn

If the in-house spec contains any of the following, the script flags them as STOP for user decision:

- Virtualized / paginated data grids (use TanStack Table + shadcn Table)
- Charts (use Recharts directly; shadcn has chart wrappers, but bespoke styling per chart needs custom work)
- Rich-text editors (use Lexical / TipTap directly)
- Date-range pickers beyond the basic Calendar
- File drop zones (use react-dropzone directly)
- Bespoke animations and transitions not expressible in Tailwind
