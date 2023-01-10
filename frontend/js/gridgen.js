// Bay grid generator

const row_div_html = '<div class="row g-2 pt-2">'
const col_div_html = '<div class="col">'

const gen_grid = (entries) => {
  // Entries is expected to be a 2D array of rows/cols to be displayed
  let html = ""

  for (let row in entries) {
    // Create a new row in the table
    row = entries[row]
    html += row_div_html;

    for (let col in row) {
      col = row[col]
      // Create a new col and card for this cell.
      html += col_div_html;

      // Get box style
      let style = "card-body";
      let sub_text_style = "text-muted";
      let title_text_style = "";
      let bi_icon = "bi-app"

      if (col['status'] == "lockout") {
        style = "card-body bg-dark";
        sub_text_style = "text-white";
        title_text_style = "text-white";
        bi_icon = "bi-lock"
      }

      if (col['status'] == "error") {
        style = "card-body bg-danger";
        sub_text_style = "text-light";
        title_text_style = "text-white";
        bi_icon = "bi-exclamation-circle-fill";
      }

      if (col['status'] == "wip") {
        style = "card-body bg-primary";
        sub_text_style = "text-light";
        title_text_style = "text-white";
        bi_icon = "bi-tools"
      }

      if (col['status'] == "bench") {
        style = "card-body bg-secondary";
        sub_text_style = "text-light";
        title_text_style = "text-white";
        bi_icon = "bi-app-indicator"
      }

      if (col['status'] == "complete") {
        style = "card-body bg-success";
        sub_text_style = "text-light";
        title_text_style = "text-white";
        bi_icon = "bi-check-square-fill"
      }

      if (col['status'] == "customer") {
        style = "card-body bg-warning";
        sub_text_style = "text-light";
        title_text_style = "text-white";
        bi_icon = "bi-person-fill"
      }

      if (col['status'] == "parts") {
        style = "card-body bg-warning";
        sub_text_style = "text-light";
        title_text_style = "text-white";
        bi_icon = "bi-basket-fill"
      }

      // Check if the bay is available or in lockout, if not, don't allow the user to click it.
      if (col['status'] == "available" || col['status'] == "lockout") {
        html += `<a style='text-decoration: none;' onclick='prepare_lockout("${col['slid']}")'><div class='card'><div class='${style}'>`;
      } else {
        html += `<a style='text-decoration: none;'><div class='card'><div class='${style}'>`;
      }

      html += `<div class='card-title ${title_text_style}'>`
      if (col['high_priority']) {
          html += `<div class="spinner-grow spinner-grow-sm" role="status"></div>  `
      }
      html += `<i class='bi ${bi_icon}'></i> ${col['title']}`;
      html += `</div>`;
      html += `<div class='card-subtitle mb-2 ${sub_text_style}'>${col['bay_status']}`;

      if (col['bay_status_secondary']) {
        html += ` <small><span class="badge bg-secondary">${col['bay_status_secondary'].toUpperCase()}</span></small>`;
      }

      html += '</div></div></div></div></a>' // TODO: Do that better...
    }

    html += '</div>'
  }

  return html;
}