// The generic halves of a controlled vocabulary, shared by species.js and
// cuts.js so the two cannot drift in how they render a value or how they fill
// a <select>. Each vocabulary keeps its own list and its own named wrappers --
// this file holds only the parts that have nothing to do with WHICH
// vocabulary it is.

export function titleCase(value) {
  return value.replace(/(^|\s)\w/g, (c) => c.toUpperCase());
}

// Keeps the element's existing empty-value option if it has one, so each page
// chooses its own placeholder wording -- "-- Choose species --" where the
// field is required, "Not set" where it is optional -- without this function
// needing to know which.
export function populateSelect(select, values, selected = '') {
  const placeholder = select.querySelector('option[value=""]');
  select.replaceChildren();
  if (placeholder) select.appendChild(placeholder);
  for (const value of values) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = titleCase(value);
    option.selected = value === selected;
    select.appendChild(option);
  }
}
