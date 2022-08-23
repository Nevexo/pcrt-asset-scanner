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
    console.dir(row)

    for (let col in row) {
      col = row[col]
      console.dir(col)
      // Create a new col and card for this cell.
      html += col_div_html;

      // Get box style
      let style = "card-body";
      let sub_text_style = "text-muted";
      let title_text_style = "";
      let bi_icon = "bi-app"
      
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

      html += `<div class='card'><div class='${style}'>`;
      html += `<div class='card-title ${title_text_style}'><i class='bi ${bi_icon}'></i> ${col['title']}</div>`;
      html += `<div class='card-subtitle mb-2 ${sub_text_style}'>${col['bay_status']}</div>`;
      html += '</div></div></div>' // TODO: Do that better...
    }

    html += '</div>'
  }

  return html;
}