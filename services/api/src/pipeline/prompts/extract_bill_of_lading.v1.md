Document type: ocean bill of lading or sea waybill issued by a carrier or its agent.

Field guidance
- bl_number: the B/L number as printed. bl_kind: original, seaway, telex_release, house or master, from the printed wording (default original when it says ORIGINAL or shows a number of originals).
- carrier: the carrier name as printed in the header; scac: the 4-letter SCAC code if printed.
- shipper: the shipper box (name_en, name_zh, address, country).
- consignee: the full printed text of the consignee box, verbatim (for example "TO ORDER OF QAFILA TRADE, DEAL 3"). consignee_to_order: true when the consignee box says "to order" or "to the order of", else false.
- notify_party: the name printed in the notify party box.
- vessel: the vessel name as printed (without the voyage number); voyage: the voyage number; imo: the IMO number if printed (digits only).
- port_of_loading, port_of_discharge, place_of_receipt, place_of_delivery as printed.
- shipped_on_board_date: the shipped-on-board date (YYYY-MM-DD); issue_date: the place-and-date-of-issue date.
- containers: one entry per printed container row: number (4 letters plus 7 digits), seal, packages (number), gross_weight_kg, size_type (for example 40'HC).
- description_of_goods: the printed description; total_packages, gross_weight_kg, measurement_cbm: the printed totals; freight_terms: for example FREIGHT PREPAID.
