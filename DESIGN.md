# Design notes

The look borrows from flood evacuation signage: signs made to be read fast, at a distance and
under stress, which is also what a projector demo needs.

- **Colour.** Flood-navy ink `#0F2A3D` on white; a pale blue-grey surface `#EEF3F6` for the
  simulation strip and quiet fields. One signal colour, escape-route green `#00843D` (the ISO 7010
  colour for the way out), marks only the acting account's main action. Errors use `#B42318`.
- **The one loud element.** "Where the money is now" sits on a deep-water panel (`#0C2B40`; a
  lighter `#0D3048` on the dark page). Its bands are drawn to scale: donations `#2F80B8` (3.4:1 against the panel), credit
  held in the contract `#63B6E3`, paid out `#E9F2F7`. A paid credit leaves the contract box as an
  arrow; a held credit stops at a white barrier. Before allocation the credits are dashed outlines.
- **Type.** Overpass (a descendant of the US Highway Gothic road-sign face) for everything, with
  tabular figures; Overpass Mono only for hex addresses, hashes and code, with ligatures off so
  "ff" in an address never joins.
- **Structure.** Numbered markers appear only on the lifecycle, which really is a sequence. Tables
  have a total row and, for the activity, a running contract balance, so the ledger reconciles.
  On phones the acting account's panel moves up under the campaign header and tables become
  labelled rows.
- **Dark mode** redefines the same tokens (`src/styles/app.css`), never single colours, and the
  theme button cycles system, light and dark.

Two other directions were tried before building: a logistics manifest and a civic open-data
look. This build keeps the signage look and takes the manifest's ledger ideas: a still-owed
column, totals, the balance after each event, and "No ETH moved" on the allocation.
