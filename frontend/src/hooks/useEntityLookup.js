import { useState, useEffect } from "react";
import { ENTITY_OPTIONS } from "../config/entityOptions";

/**
 * Fetches the full list for a given entity ONCE, and returns a `getLabel(id)`
 * function that turns a raw foreign-key id into the same readable label
 * EntitySelect shows in its dropdown (e.g. "Ravi Transport (VEH-1023)"
 * instead of just `14`).
 *
 * Use this in DataTable `render` functions for any column that currently
 * shows a raw `_id` value, e.g.:
 *
 *   const vehicles = useEntityLookup("vehicle");
 *   ...
 *   { key: "vehicle_id", label: "Vehicle", render: (row) => vehicles.getLabel(row.vehicle_id) }
 *
 * Returns `refetch()` too — call it after a sibling <EntitySelect creatable
 * onCreated={...}> on the same page adds a new row via quick-create, so
 * table columns using this lookup show the real label right away instead
 * of a "#id" fallback until the page is next reloaded.
 */
export function useEntityLookup(entity) {
  const config = ENTITY_OPTIONS[entity];
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    let alive = true;
    setLoading(true);
    config
      .fetch()
      .then((data) => {
        if (alive) setRows(data || []);
      })
      .catch(() => {
        // Swallow errors — getLabel() below just falls back to "#id"
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [entity]);
  const refetch = () => load();

  const getLabel = (id) => {
    if (id === null || id === undefined || id === "") return "—";
    const row = rows.find((r) => String(r.id) === String(id));
    if (row) return config.getLabel(row);
    return loading ? "…" : `#${id}`;
  };

  return { getLabel, loading, rows, refetch };
}