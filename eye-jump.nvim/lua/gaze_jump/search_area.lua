local M = {}

function M.new(transform, frame, rows, cols, radius)
  local x, y = transform.x, transform.y
  local point, display = frame.point, frame.display
  local cell_x = x[1] * display.width / cols
  local cell_y = y[1] * display.height / cols
  local radius_pixels = (radius or 10) * math.sqrt(cell_x * cell_x + cell_y * cell_y)
  local area = { radius_squared = radius_pixels * radius_pixels }

  function area:distance(row, col)
    local u, v = (col - 0.5) / cols, (row - 0.5) / rows
    local dx = (x[1] * u + x[2] * v + x[3] - point.x) * display.width
    local dy = (y[1] * u + y[2] * v + y[3] - point.y) * display.height
    return dx * dx + dy * dy
  end

  function area:contains(row, col)
    return self:distance(row, col) <= self.radius_squared + math.max(1, self.radius_squared) * 1e-12
  end

  return area
end

return M
