# DIM Watermark Data

Vendored from [DestinyItemManager/d2-additional-info](https://github.com/DestinyItemManager/d2-additional-info)
(`output/watermark-to-season.json`, `output/watermark-to-event.json`), MIT licensed — see `LICENSE.md`.

Maps a weapon/armor item's `iconWatermark` path to a Destiny 2 season or event number.
Used by `destiny-manifest.js` to label weapon search results with their season of origin,
so visually-identical duplicate names (reissues, curated rolls, etc.) can be told apart.

Since Destiny 2 is permanently frozen as of Monument of Triumph, this data will never
need to be updated again.
