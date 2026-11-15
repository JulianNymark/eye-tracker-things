local uv = vim.uv or vim.loop
local alignment = require('gaze_jump.alignment')
local M = {}
local active
local target_ns = vim.api.nvim_create_namespace('gaze_jump_calibration_target')

local function finite(n)
  return type(n) == 'number' and n == n and math.abs(n) < math.huge
end

local function valid(saved)
  if type(saved) ~= 'table' or saved.version ~= 1 or
      (saved.source ~= 'demo' and saved.source ~= 'tobii') or
      (saved.setup ~= nil and type(saved.setup) ~= 'string') or
      not finite(saved.rows) or not finite(saved.cols) or saved.rows < 1 or saved.cols < 1 or
      type(saved.display) ~= 'table' or not finite(saved.display.width) or not finite(saved.display.height) or
      saved.display.width <= 0 or saved.display.height <= 0 or type(saved.transform) ~= 'table' or
      type(saved.transform.x) ~= 'table' or type(saved.transform.y) ~= 'table' then return false end
  for i = 1, 3 do
    if not finite(saved.transform.x[i]) or not finite(saved.transform.y[i]) then return false end
  end
  return alignment.to_grid(saved.transform, 0.5, 0.5) ~= nil
end

function M.load(path)
  local stat = uv.fs_stat(path)
  if not stat or stat.size > 16384 then return nil end
  local ok, lines = pcall(vim.fn.readfile, path)
  if not ok then return nil end
  local decoded_ok, saved = pcall(vim.json.decode, table.concat(lines, '\n'))
  return decoded_ok and valid(saved) and saved or nil
end

local function save(path, value)
  local ok, err = pcall(function()
    local directory = vim.fn.fnamemodify(path, ':h')
    if vim.fn.mkdir(directory, 'p', 448) == 0 and not uv.fs_stat(directory) then
      error('Cannot create alignment directory')
    end
    local tmp = path .. '.' .. tostring(uv.hrtime()) .. '.tmp'
    local fd, open_error = uv.fs_open(tmp, 'wx', 384)
    if not fd then error(open_error) end
    local data = vim.json.encode(value) .. '\n'
    local written, write_error = uv.fs_write(fd, data, 0)
    uv.fs_close(fd)
    if written ~= #data then uv.fs_unlink(tmp); error(write_error or 'Incomplete alignment write') end
    local renamed, rename_error = uv.fs_rename(tmp, path)
    if not renamed then uv.fs_unlink(tmp); error(rename_error) end
  end)
  return ok, err
end

local function close()
  local session = active
  active = nil
  if session and vim.api.nvim_win_is_valid(session.win) then vim.api.nvim_win_close(session.win, true) end
  if session and vim.api.nvim_buf_is_valid(session.buf) then vim.api.nvim_buf_delete(session.buf, { force = true }) end
end

function M.cancel()
  if active then close() end
end

local function write_at(lines, row, col, text)
  local old = lines[row]
  lines[row] = old:sub(1, col - 1) .. text .. old:sub(col + #text)
end

local function draw(message)
  local s = active
  if not s or not vim.api.nvim_win_is_valid(s.win) then return end
  local target = s.targets[s.index]
  local lines = {}
  for row = 1, s.height do lines[row] = string.rep(' ', s.cols) end
  local header = ('Eye alignment %d/%d: look at cell center, press Space; Esc cancels'):format(s.index, #s.targets)
  write_at(lines, 1, 1, header:sub(1, s.cols))
  if message then write_at(lines, 2, 1, message:sub(1, s.cols)) end
  write_at(lines, target.row - 1, target.col - 3, ' /---\\ ')
  write_at(lines, target.row, target.col - 3, '|     |')
  write_at(lines, target.row + 1, target.col - 3, ' \\---/ ')
  vim.bo[s.buf].modifiable = true
  vim.api.nvim_buf_set_lines(s.buf, 0, -1, false, lines)
  vim.api.nvim_buf_clear_namespace(s.buf, target_ns, 0, -1)
  vim.api.nvim_buf_set_extmark(s.buf, target_ns, target.row - 1, target.col - 1, {
    end_col = target.col, hl_group = 'GazeJumpCalibrationTarget',
  })
  vim.bo[s.buf].modifiable = false
  vim.cmd('redraw')
  local pos = vim.fn.screenpos(s.win, target.row, target.col)
  if pos.row <= 0 or pos.col <= 0 then close(); vim.notify('Gaze alignment: target is not visible', vim.log.levels.ERROR); return end
  s.target = { row = pos.row, col = pos.col }
  s.displayed = uv.hrtime()
end

local function collect()
  local s = active
  if not s then return end
  if vim.o.lines ~= s.rows or vim.o.columns ~= s.cols then
    close(); vim.notify('Gaze alignment cancelled: editor size changed', vim.log.levels.WARN); return
  end
  local samples = s.opts.samples(s.displayed)
  local now = uv.hrtime()
  if #samples < 3 or (now - samples[#samples].received) / 1e6 > 200 or
      (samples[#samples].received - samples[1].received) / 1e6 < 80 then
    draw('Wait for fresh gaze, look at the cell center, then press Space again')
    return
  end
  local x, y = 0, 0
  for _, sample in ipairs(samples) do x = x + sample.frame.point.x; y = y + sample.frame.point.y end
  x, y = x / #samples, y / #samples
  local spread = 0
  for _, sample in ipairs(samples) do
    local dx, dy = sample.frame.point.x - x, sample.frame.point.y - y
    spread = spread + dx * dx + dy * dy
  end
  if math.sqrt(spread / #samples) > 0.06 then
    draw('Gaze is moving; look steadily at the dot and try again')
    return
  end
  s.samples[#s.samples + 1] = {
    u = (s.target.col - 0.5) / s.cols, v = (s.target.row - 0.5) / s.rows, x = x, y = y,
  }
  s.index = s.index + 1
  if s.index <= #s.targets then draw(); return end
  local transform, err = alignment.fit(s.samples)
  if not transform then close(); vim.notify('Gaze alignment failed: ' .. err, vim.log.levels.ERROR); return end
  local value = { version = 1, rows = s.rows, cols = s.cols, source = s.opts.source,
    setup = s.opts.setup, display = s.opts.display, transform = transform }
  if transform.rms > 0.12 then
    close(); vim.notify('Gaze alignment failed: samples are too inconsistent; try again', vim.log.levels.WARN); return
  end
  local ok, save_error = save(s.opts.path, value)
  s.opts.on_finish(value)
  close()
  if ok then
    vim.notify(('Gaze alignment saved (fit error %.1f%% of display)'):format(transform.rms * 100))
  else
    vim.notify('Gaze alignment works for this session but could not be saved: ' .. tostring(save_error), vim.log.levels.WARN)
  end
end

function M.start(opts)
  if active then vim.notify('Gaze alignment is already running', vim.log.levels.WARN); return end
  local rows, cols = vim.o.lines, vim.o.columns
  local height = rows - vim.o.cmdheight
  if cols < 40 or height < 15 then
    vim.notify('Gaze alignment needs a terminal at least 40 columns by 15 rows', vim.log.levels.WARN)
    return
  end
  local left, right = 5, cols - 4
  local top, bottom = 4, height - 2
  local midx, midy = math.floor((left + right) / 2), math.floor((top + bottom) / 2)
  local targets = {
    { row = midy, col = midx }, { row = top, col = left }, { row = top, col = right },
    { row = bottom, col = right }, { row = bottom, col = left },
    { row = top, col = midx }, { row = midy, col = right },
    { row = bottom, col = midx }, { row = midy, col = left },
  }
  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_set_hl(0, 'GazeJumpCalibrationTarget', { bg = '#ffdd00', default = true })
  vim.bo[buf].bufhidden = 'wipe'
  local win = vim.api.nvim_open_win(buf, true, {
    relative = 'editor', row = 0, col = 0, width = cols, height = height,
    style = 'minimal', border = 'none', zindex = 200,
  })
  vim.wo[win].number = false
  vim.wo[win].relativenumber = false
  vim.wo[win].signcolumn = 'no'
  vim.wo[win].foldcolumn = '0'
  vim.wo[win].wrap = false
  vim.wo[win].list = false
  active = { opts = opts, rows = rows, cols = cols, height = height, targets = targets,
    index = 1, samples = {}, buf = buf, win = win }
  vim.keymap.set('n', '<Space>', collect, { buffer = buf, nowait = true, silent = true })
  vim.keymap.set('n', '<Esc>', function() close(); vim.notify('Gaze alignment cancelled') end,
    { buffer = buf, nowait = true, silent = true })
  vim.api.nvim_create_autocmd({ 'WinClosed', 'VimResized' }, {
    buffer = buf,
    once = true,
    callback = function() if active and active.buf == buf then close() end end,
  })
  draw()
end

-- Exposed for observing the active target in integration tests.
function M.target()
  return active and active.target and vim.deepcopy(active.target) or nil
end

return M
