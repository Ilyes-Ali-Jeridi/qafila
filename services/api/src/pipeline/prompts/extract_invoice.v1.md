Document type: commercial or pro-forma invoice from a Chinese supplier.

Field guidance
- invoice_kind: "proforma" when the title says pro-forma or proforma, "commercial" when it says commercial invoice; otherwise your best reading with lower confidence.
- seller: the issuing company (name_en, name_zh, uscc = the 18-character Unified Social Credit Code if printed, address, country code).
- buyer: the party named as buyer, bill-to or sold-to. Copy the name exactly, including any deal reference such as "Qafila Trade, deal 7".
- consignee: the party named as consignee if printed, else null. If it says "to order of X", set consignee.name_en to the full printed phrase.
- notify_party: the name of the notify party if printed.
- incoterms: the three-letter term plus the named place as printed (for example "FOB Shenzhen (Yantian)").
- currency: the invoice currency code.
- total: the printed grand total as a number.
- line_items: description_en, description_zh, hs_code (digits only), quantity, unit (pcs, sets, m, kg, sqm, bottles...), unit_price, line_total, all as printed.
- port_of_loading and port_of_discharge as printed, including any UN/LOCODE in brackets.
- payment_terms: the printed payment terms sentence.
