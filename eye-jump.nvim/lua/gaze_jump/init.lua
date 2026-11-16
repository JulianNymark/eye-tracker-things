local M = {}
local uv = vim.uv or vim.loop
local alignment = require('gaze_jump.alignment')
local search_area = require('gaze_jump.search_area')

local config
local current
local history = {}
local fitted = {}
local connection
local connected = false
local retry
local stopped = true
local correction
local correction_group
local correction_keys = vim.api.nvim_create_namespace('gaze_jump.correction')

local function finite(value)
  return type(value) == 'number' and value == value and math.abs(value) < math.huge
end

local function valid_frame(frame)
  if type(frame) ~= 'table' or frame.version ~= 1 or
      (frame.source ~= 'tobii' and frame.source ~= 'demo') or
      (frame.source == 'demo' and not config.allow_demo) or
      type(frame.display) ~= 'table' or not finite(frame.display.width) or
      not finite(frame.display.height) or frame.display.width <= 0 or frame.display.height <= 0 then
    return false
  end
  local p = frame.point
  return type(p) == 'table' and finite(p.x) and finite(p.y) and
    p.x >= 0 and p.x <= 1 and p.y >= 0 and p.y <= 1
end

local function disconnect()
  connected = false
  current = nil
  history = {}
  if connection and not connection:is_closing() then
    connection:read_stop()
    connection:close()
  end
  connection = nil
end

local connect
local function schedule_retry()
  if stopped or retry then return end
  retry = uv.new_timer()
  retry:start(1000, 0, function()
    retry:close()
    retry = nil
    if not stopped then connect() end
  end)
end

connect = function()
  local pipe = uv.new_pipe(false)
  connection = pipe
  pipe:connect(config.socket, function(err)
    if stopped or connection ~= pipe then return end
    if err then disconnect(); schedule_retry(); return end
    connected = true
    local buffer = ''
    pipe:read_start(function(read_err, chunk)
      if connection ~= pipe then return end
      if read_err or not chunk then disconnect(); schedule_retry(); return end
      buffer = buffer .. chunk
      if #buffer > 65536 then disconnect(); schedule_retry(); return end
      while true do
        local newline = buffer:find('\n', 1, true)
        if not newline then break end
        local line = buffer:sub(1, newline - 1)
        buffer = buffer:sub(newline + 1)
        local ok, frame = pcall(vim.json.decode, line)
        if ok and valid_frame(frame) then
          current = { frame = frame, received = uv.hrtime() }
          history[#history + 1] = current
          while #history > 0 and (current.received - history[1].received) / 1e6 > 600 do
            table.remove(history, 1)
          end
        else
          current = nil
          history = {}
        end
      end
    end)
  end)
end

function M.stop()
  stopped = true
  correction = nil
  if correction_group then vim.api.nvim_del_augroup_by_id(correction_group); correction_group = nil end
  vim.on_key(nil, correction_keys)
  require('gaze_jump.debug').stop()
  require('gaze_jump.calibration').cancel()
  disconnect()
  if retry and not retry:is_closing() then retry:stop(); retry:close() end
  retry = nil
end

local function setup_matches(saved, frame)
  if saved == frame.setup then return true end
  if type(saved) ~= 'string' or type(frame.setupAliases) ~= 'table' or #frame.setupAliases > 8 then return false end
  for _, alias in ipairs(frame.setupAliases) do
    if alias == saved then return true end
  end
  return false
end

local function alignment_state(fit, frame)
  if not fit then return 'not_saved' end
  if fit.source ~= frame.source then return 'source_changed' end
  if not setup_matches(fit.setup, frame) then return 'tracker_setup_changed' end
  if fit.display.width ~= frame.display.width or fit.display.height ~= frame.display.height then return 'display_changed' end
  if fit.rows ~= vim.o.lines or fit.cols ~= vim.o.columns then return 'resized' end
  return 'ready'
end

function M.status()
  if not current then
    return { connected = connected, ready = false, aligned = false,
      saved_alignment = { tobii = fitted.tobii ~= nil, demo = fitted.demo ~= nil }, alignment = 'no_gaze' }
  end
  local age = (uv.hrtime() - current.received) / 1e6
  local fit = fitted[current.frame.source]
  local state = alignment_state(fit, current.frame)
  if state ~= 'ready' and state ~= 'resized' and config.viewport then state = 'manual_viewport' end
  return {
    connected = connected,
    ready = age <= config.max_age_ms,
    age_ms = age,
    source = current.frame.source,
    setup = current.frame.setup,
    point = vim.deepcopy(current.frame.point),
    display = vim.deepcopy(current.frame.display),
    aligned = M.active_transform(current.frame) ~= nil,
    alignment = state,
    saved_grid = fit and { rows = fit.rows, cols = fit.cols } or nil,
    current_grid = { rows = vim.o.lines, cols = vim.o.columns },
  }
end

local function viewport_transform(viewport)
  return { x = { viewport.width, 0, viewport.x }, y = { 0, viewport.height, viewport.y } }
end

function M.active_transform(frame)
  local fit = fitted[frame.source]
  local state = alignment_state(fit, frame)
  if state == 'ready' or state == 'resized' then
    return alignment.for_grid(fit.transform, fit.cols, fit.rows, vim.o.columns, vim.o.lines)
  end
  return config.viewport and viewport_transform(config.viewport) or nil
end

-- Transform normalized editor-grid coordinates to normalized display gaze.
function M.find_candidates(win, character, frame, mapping, rows, cols, case_mode, search_radius)
  local transform = type(mapping.x) == 'table' and mapping or viewport_transform(mapping)
  -- Explicit case flags keep smart-case matching independent of search options.
  -- Match the original text so Unicode case conversion cannot shift byte columns.
  local ignore_case = case_mode == 'insensitive' or
    ((case_mode == nil or case_mode == 'smart') and character == vim.fn.tolower(character))
  local case = ignore_case and '\\c' or '\\C'
  local pattern = case .. '\\V' .. vim.fn.escape(character, '\\')
  local p = frame.point
  local u, v = alignment.to_grid(transform, p.x, p.y)
  if not u or u < 0 or u > 1 or v < 0 or v > 1 then return {} end
  local area = search_area.new(transform, frame, rows, cols, search_radius or 10)
  local buffer = vim.api.nvim_win_get_buf(win)
  local first = vim.fn.line('w0', win)
  local last = vim.fn.line('w$', win)
  local lines = vim.api.nvim_buf_get_lines(buffer, first - 1, last, false)
  local candidates = {}
  for i, text in ipairs(lines) do
    -- screenpos() maps hidden folded lines to the fold header; they are not
    -- visible jump targets and would otherwise compete at the same position.
    local line_number = first + i - 1
    local folded
    if vim.api.nvim_get_current_win() == win then
      folded = vim.fn.foldclosed(line_number) ~= -1
    else
      folded = vim.api.nvim_win_call(win, function() return vim.fn.foldclosed(line_number) ~= -1 end)
    end
    if not folded then
      local start = 0
      while true do
        local match = vim.fn.matchstrpos(text, pattern, start)
        if match[2] == -1 then break end
        local col = match[2] + 1
        local pos = vim.fn.screenpos(win, line_number, col)
        if pos.row > 0 and pos.col > 0 and pos.row <= rows and pos.col <= cols then
          if area:contains(pos.row, pos.col) then
            candidates[#candidates + 1] = { position = { line_number, col - 1 },
              distance = area:distance(pos.row, pos.col) }
          end
        end
        start = match[3]
      end
    end
  end
  table.sort(candidates, function(a, b)
    if a.distance ~= b.distance then return a.distance < b.distance end
    if a.position[1] ~= b.position[1] then return a.position[1] < b.position[1] end
    return a.position[2] < b.position[2]
  end)
  return candidates
end

function M.find_nearest(win, character, frame, mapping, rows, cols, case_mode, search_radius)
  local candidates = M.find_candidates(win, character, frame, mapping, rows, cols, case_mode, search_radius)
  return candidates[1] and candidates[1].position or nil
end

local function correction_view(win)
  return vim.api.nvim_win_call(win, function()
    local view = vim.fn.winsaveview()
    return { topline = view.topline, leftcol = view.leftcol, skipcol = view.skipcol, topfill = view.topfill,
      position = vim.api.nvim_win_get_position(win), width = vim.api.nvim_win_get_width(win),
      height = vim.api.nvim_win_get_height(win), rows = vim.o.lines, cols = vim.o.columns }
  end)
end

local function correction_valid()
  if not correction then return false end
  local state = correction
  if not vim.api.nvim_win_is_valid(state.win) or vim.api.nvim_get_current_win() ~= state.win or
      vim.api.nvim_win_get_buf(state.win) ~= state.buffer or
      vim.api.nvim_buf_get_changedtick(state.buffer) ~= state.changedtick or
      not vim.deep_equal(vim.api.nvim_win_get_cursor(state.win), state.candidates[state.index].position) or
      not vim.deep_equal(correction_view(state.win), state.view) then
    correction = nil
    return false
  end
  return true
end

local function cycle_candidate(step)
  if not correction_valid() then return false end
  local state = correction
  local index = state.index + step
  if index < 1 or index > #state.candidates then
    return true
  end
  local target = state.candidates[index].position
  local pos = vim.fn.screenpos(state.win, target[1], target[2] + 1)
  if vim.fn.foldclosed(target[1]) ~= -1 or pos.row <= 0 or pos.col <= 0 then
    correction = nil
    return false
  end
  state.index = index
  vim.api.nvim_win_set_cursor(state.win, target)
  return true
end

-- True means handled, including an exhausted set; false lets mappings fall back.
function M.next_candidate()
  return cycle_candidate(1)
end

function M.previous_candidate()
  return cycle_candidate(-1)
end

local function no_gaze_message()
  if not connected then
    return 'Eye jump: bridge not connected; start it with pnpm bridge and check the socket path'
  end
  return 'Eye jump: bridge connected, but no fresh gaze; check the tracker and bridge calibration'
end

function M.jump()
  correction = nil
  local captured = current
  if not captured or (uv.hrtime() - captured.received) / 1e6 > config.max_age_ms then
    vim.notify(no_gaze_message(), vim.log.levels.WARN)
    return
  end
  local transform = M.active_transform(captured.frame)
  if not transform then
    local state = alignment_state(fitted[captured.frame.source], captured.frame)
    vim.notify('Eye jump: alignment unavailable (' .. state .. '); check status or recalibrate', vim.log.levels.WARN)
    return
  end
  local win = vim.api.nvim_get_current_win()
  local buffer = vim.api.nvim_win_get_buf(win)
  local rows, cols = vim.o.lines, vim.o.columns
  local char = vim.fn.getcharstr()
  if char == '\27' or char == '' or vim.fn.strchars(char) ~= 1 or char:byte() < 32 then return end
  if not vim.api.nvim_win_is_valid(win) or vim.api.nvim_get_current_win() ~= win or
      vim.api.nvim_win_get_buf(win) ~= buffer or rows ~= vim.o.lines or cols ~= vim.o.columns then
    vim.notify('Eye jump: editor changed while waiting for input', vim.log.levels.WARN)
    return
  end
  local candidates = M.find_candidates(win, char, captured.frame, transform, rows, cols,
    config.case_mode, config.search_radius)
  if candidates[1] then
    vim.api.nvim_win_set_cursor(win, candidates[1].position)
    correction = { win = win, buffer = buffer, changedtick = vim.api.nvim_buf_get_changedtick(buffer),
      candidates = candidates, index = 1, view = correction_view(win) }
  else vim.notify('Eye jump: no visible match within the search radius', vim.log.levels.INFO) end
end

function M.setup(opts)
  M.stop()
  opts = opts or {}
  local v = opts.viewport
  assert(v == nil or (type(v) == 'table' and finite(v.x) and finite(v.y) and finite(v.width) and finite(v.height)
    and v.x >= 0 and v.y >= 0 and v.width > 0 and v.height > 0
    and v.x + v.width <= 1 and v.y + v.height <= 1), 'gaze_jump: invalid viewport')
  config = {
    case_mode = opts.case_mode == nil and 'smart' or opts.case_mode,
    search_radius = opts.search_radius == nil and 10 or opts.search_radius,
    show_search_radius = opts.show_search_radius ~= false,
    viewport = vim.deepcopy(v),
    socket = opts.socket or vim.fn.expand('~/.local/share/eye-jump/gaze.sock'),
    max_age_ms = opts.max_age_ms or 200,
    allow_demo = opts.allow_demo == true,
    alignment_path = opts.alignment_path or (vim.fn.stdpath('state') .. '/eye-jump/alignment.json'),
  }
  assert(finite(config.max_age_ms) and config.max_age_ms > 0, 'gaze_jump: invalid max_age_ms')
  assert(config.case_mode == 'smart' or config.case_mode == 'sensitive' or config.case_mode == 'insensitive',
    'gaze_jump: invalid case_mode')
  assert(finite(config.search_radius) and config.search_radius > 0, 'gaze_jump: invalid search_radius')
  local calibration = require('gaze_jump.calibration')
  fitted = {
    tobii = calibration.load(config.alignment_path),
    demo = calibration.load(config.alignment_path .. '.demo'),
  }
  stopped = false
  correction_group = vim.api.nvim_create_augroup('GazeJumpCorrection', { clear = true })
  vim.api.nvim_create_autocmd({ 'CursorMoved', 'WinScrolled', 'WinResized', 'VimResized' }, {
    group = correction_group, callback = function() correction_valid() end,
  })
  vim.api.nvim_create_autocmd({ 'TextChanged', 'TextChangedI', 'InsertEnter', 'BufLeave', 'WinLeave' }, {
    group = correction_group, callback = function(event)
      if correction and event.buf == correction.buffer then correction = nil end
    end,
  })
  -- Native character-find commands replace ;/, even when no match moves the cursor.
  vim.on_key(function(key)
    if correction and key:match('^[fFtT]$') and vim.fn.mode() == 'n' then correction = nil end
  end, correction_keys)
  connect()
end

function M.show_status()
  vim.notify('Eye jump: ' .. vim.inspect(M.status()))
end

function M.toggle_debug()
  local enabled = require('gaze_jump.debug').toggle(function()
    if stopped or not current or (uv.hrtime() - current.received) / 1e6 > config.max_age_ms or
        require('gaze_jump.calibration').target() then return nil end
    local transform = M.active_transform(current.frame)
    return transform and { transform = transform, point = current.frame.point, display = current.frame.display,
      search_radius = config.search_radius, show_search_radius = config.show_search_radius } or nil
  end)
  vim.notify(enabled and 'Gaze marker on' or 'Gaze marker off')
end

function M.calibrate()
  correction = nil
  if not current or (uv.hrtime() - current.received) / 1e6 > config.max_age_ms then
    vim.notify(no_gaze_message(), vim.log.levels.WARN)
    return
  end
  local initial = current.frame
  require('gaze_jump.calibration').start({
    source = initial.source,
    setup = initial.setup,
    display = vim.deepcopy(initial.display),
    path = initial.source == 'demo' and config.alignment_path .. '.demo' or config.alignment_path,
    status = M.status,
    samples = function(since)
      local now = uv.hrtime()
      local result = {}
      for _, sample in ipairs(history) do
        if sample.received >= since and (now - sample.received) / 1e6 <= 350 and
            sample.frame.source == initial.source and sample.frame.setup == initial.setup and
            sample.frame.display.width == initial.display.width and sample.frame.display.height == initial.display.height then
          result[#result + 1] = sample
        end
      end
      return result
    end,
    on_finish = function(value) fitted[initial.source] = value end,
  })
end

return M
