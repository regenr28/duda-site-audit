-- Duda Site Auditor: the app's storage in Supabase (Postgres).
--
-- Paste all of this into Supabase → SQL Editor → New query, and press Run. Running it again is safe:
-- it only creates what is missing and replaces the one function with its latest version.
--
-- The app was built on a key-value store (Upstash Redis). Rather than rewrite every part of the app,
-- the same records live here in five plain tables, and one function, public.dsa_exec, answers the
-- app's requests exactly the way the key-value store did. Every feature works unchanged.
--
-- Security: the tables sit in their own schema (dsa_kv) that the public Data API never shows, and the
-- function can only be called with the project's SECRET key (service_role), which lives only in
-- Vercel's environment variables. The anon/publishable key can do nothing here.

create schema if not exists dsa_kv;

-- Every record: its name, what kind it is, its value when it is plain text, and when it expires.
create table if not exists dsa_kv.keys (
  k   text primary key,
  t   text not null check (t in ('string', 'hash', 'list', 'set', 'zset')),
  v   text,
  exp timestamptz
);
create index if not exists keys_exp on dsa_kv.keys (exp) where exp is not null;

-- Records made of named fields (an audit list, settings, counters). n keeps the order fields arrived in.
create table if not exists dsa_kv.hash (
  k text not null references dsa_kv.keys (k) on delete cascade,
  f text not null,
  v text not null,
  n bigint generated always as identity,
  primary key (k, f)
);
create index if not exists hash_order on dsa_kv.hash (k, n);

-- Ordered lists (activity logs, notifications). pos only ever grows outward from 0.
create table if not exists dsa_kv.list (
  k   text not null references dsa_kv.keys (k) on delete cascade,
  pos bigint not null,
  v   text not null,
  primary key (k, pos)
);

-- Sets (who is a user, which items are marked fine).
create table if not exists dsa_kv.sets (
  k text not null references dsa_kv.keys (k) on delete cascade,
  m text not null,
  primary key (k, m)
);

-- Scored sets (kept for completeness; the app barely uses them).
create table if not exists dsa_kv.zset (
  k     text not null references dsa_kv.keys (k) on delete cascade,
  m     text not null,
  score double precision not null,
  primary key (k, m)
);
create index if not exists zset_order on dsa_kv.zset (k, score, m);

alter table dsa_kv.keys enable row level security;
alter table dsa_kv.hash enable row level security;
alter table dsa_kv.list enable row level security;
alter table dsa_kv.sets enable row level security;
alter table dsa_kv.zset enable row level security;

-- ---------------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------------

-- What kind a record is, or null when there is none. A record past its expiry is removed on the spot.
create or replace function dsa_kv.live(key text) returns text
language plpgsql set search_path = dsa_kv, pg_temp as $$
declare r record;
begin
  select t, exp into r from dsa_kv.keys where k = key;
  if not found then return null; end if;
  if r.exp is not null and r.exp <= clock_timestamp() then
    delete from dsa_kv.keys where k = key;
    return null;
  end if;
  return r.t;
end $$;

-- Make sure a record of this kind exists (creating it empty), or refuse if it is another kind.
create or replace function dsa_kv.need(key text, kind text) returns void
language plpgsql set search_path = dsa_kv, pg_temp as $$
declare cur text := dsa_kv.live(key);
begin
  if cur is null then
    insert into dsa_kv.keys (k, t) values (key, kind) on conflict (k) do nothing;
    cur := (select t from dsa_kv.keys where k = key);
  end if;
  if cur <> kind then raise exception 'WRONGTYPE Operation against a key holding the wrong kind of value'; end if;
end $$;

-- Check the kind without creating anything. Returns true when the record exists.
create or replace function dsa_kv.has(key text, kind text) returns boolean
language plpgsql set search_path = dsa_kv, pg_temp as $$
declare cur text := dsa_kv.live(key);
begin
  if cur is null then return false; end if;
  if cur <> kind then raise exception 'WRONGTYPE Operation against a key holding the wrong kind of value'; end if;
  return true;
end $$;

-- A collection that has become empty stops existing, as it does in a key-value store.
create or replace function dsa_kv.tidy(key text, kind text) returns void
language plpgsql set search_path = dsa_kv, pg_temp as $$
declare left_over boolean;
begin
  if kind = 'hash' then left_over := exists (select 1 from dsa_kv.hash where k = key);
  elsif kind = 'list' then left_over := exists (select 1 from dsa_kv.list where k = key);
  elsif kind = 'set' then left_over := exists (select 1 from dsa_kv.sets where k = key);
  elsif kind = 'zset' then left_over := exists (select 1 from dsa_kv.zset where k = key);
  else return; end if;
  if not left_over then delete from dsa_kv.keys where k = key and t = kind; end if;
end $$;

create or replace function dsa_kv.int_of(s text) returns bigint
language plpgsql immutable as $$
begin
  if s is null then return 0; end if;
  if s !~ '^\s*-?[0-9]+\s*$' then raise exception 'ERR value is not an integer or out of range'; end if;
  return s::bigint;
end $$;

-- Redis-style index range (negatives count from the end) → zero-based [from, to], or null when empty.
create or replace function dsa_kv.span(len bigint, a bigint, b bigint) returns bigint[]
language plpgsql immutable as $$
begin
  if a < 0 then a := len + a; end if;
  if b < 0 then b := len + b; end if;
  if a < 0 then a := 0; end if;
  if b >= len then b := len - 1; end if;
  if a > b or len = 0 then return null; end if;
  return array[a, b];
end $$;

-- A Redis glob (* ? and \ escapes) as a LIKE pattern.
create or replace function dsa_kv.glob(p text) returns text
language sql immutable as $$
  select replace(replace(replace(replace(replace(p, '\', '\\'), '%', '\%'), '_', '\_'), '*', '%'), '?', '_')
$$;

-- ---------------------------------------------------------------------------------------------------
-- One command
-- ---------------------------------------------------------------------------------------------------
create or replace function dsa_kv.cmd(c text[]) returns jsonb
language plpgsql set search_path = dsa_kv, pg_temp as $$
#variable_conflict use_column
declare
  op   text := upper(c[1]);
  key  text := c[2];
  nargs int := coalesce(array_length(c, 1), 0);
  i    int;
  n    bigint;
  m    bigint;
  cur  text;
  val  text;
  prev text;
  exp_at timestamptz;
  keep_ttl boolean;
  nx boolean; xx boolean; want_get boolean; is_new boolean;
  rng bigint[];
  res  jsonb;
  last_key text;
  pat text;
  cnt int;
  only_type text;
  base bigint;
begin
  case op

  -- ----- plain values -----
  when 'GET' then
    if not dsa_kv.has(key, 'string') then return 'null'; end if;
    return to_jsonb((select v from dsa_kv.keys where k = key));

  when 'MGET' then
    res := '[]';
    for i in 2..nargs loop
      cur := dsa_kv.live(c[i]);
      if cur = 'string' then res := res || jsonb_build_array((select v from dsa_kv.keys where k = c[i]));
      else res := res || jsonb_build_array(null); end if;
    end loop;
    return res;

  when 'SET', 'SETEX', 'PSETEX', 'SETNX' then
    nx := op = 'SETNX'; xx := false; keep_ttl := false; want_get := false; exp_at := null;
    if op = 'SETEX' then exp_at := clock_timestamp() + make_interval(secs => (c[3]::numeric)::double precision); val := c[4];
    elsif op = 'PSETEX' then exp_at := clock_timestamp() + make_interval(secs => (c[3]::numeric / 1000)::double precision); val := c[4];
    else
      val := c[3];
      i := 4;
      while i <= nargs loop
        case upper(c[i])
          when 'NX' then nx := true;
          when 'XX' then xx := true;
          when 'GET' then want_get := true;
          when 'KEEPTTL' then keep_ttl := true;
          when 'EX' then exp_at := clock_timestamp() + make_interval(secs => (c[i + 1]::numeric)::double precision); i := i + 1;
          when 'PX' then exp_at := clock_timestamp() + make_interval(secs => (c[i + 1]::numeric / 1000)::double precision); i := i + 1;
          when 'EXAT' then exp_at := to_timestamp(c[i + 1]::numeric); i := i + 1;
          when 'PXAT' then exp_at := to_timestamp(c[i + 1]::numeric / 1000); i := i + 1;
          else raise exception 'ERR syntax error';
        end case;
        i := i + 1;
      end loop;
    end if;
    cur := dsa_kv.live(key);
    if want_get then
      if cur is not null and cur <> 'string' then raise exception 'WRONGTYPE Operation against a key holding the wrong kind of value'; end if;
      prev := (select v from dsa_kv.keys where k = key);
    end if;
    if xx and cur is null then return case when want_get then to_jsonb(prev) else 'null' end; end if;
    if nx then
      -- Only if nothing is there: the insert either wins or quietly does nothing (safe for locks).
      insert into dsa_kv.keys (k, t, v, exp) values (key, 'string', val, exp_at) on conflict (k) do nothing;
      if not found then return case when want_get then to_jsonb(prev) else 'null' end; end if;
      return case when want_get then 'null' else '"OK"' end;
    end if;
    if cur is not null and cur <> 'string' then delete from dsa_kv.keys where k = key; end if;
    insert into dsa_kv.keys (k, t, v, exp) values (key, 'string', val, exp_at)
      on conflict (k) do update set t = 'string', v = excluded.v,
        exp = case when keep_ttl then dsa_kv.keys.exp else excluded.exp end;
    return case when want_get then to_jsonb(prev) else '"OK"' end;

  when 'STRLEN' then
    if not dsa_kv.has(key, 'string') then return '0'; end if;
    return to_jsonb(octet_length((select v from dsa_kv.keys where k = key)));

  when 'INCR', 'INCRBY', 'DECR', 'DECRBY' then
    n := case op when 'INCR' then 1 when 'DECR' then -1 when 'INCRBY' then c[3]::bigint else -c[3]::bigint end;
    if dsa_kv.has(key, 'string') then
      update dsa_kv.keys set v = (dsa_kv.int_of(v) + n)::text where k = key returning v::bigint into m;
    else
      insert into dsa_kv.keys (k, t, v) values (key, 'string', n::text)
        on conflict (k) do update set v = (dsa_kv.int_of(dsa_kv.keys.v) + n)::text returning v::bigint into m;
    end if;
    return to_jsonb(m);

  -- ----- any record -----
  when 'DEL', 'UNLINK' then
    n := 0;
    for i in 2..nargs loop
      if dsa_kv.live(c[i]) is not null then delete from dsa_kv.keys where k = c[i]; n := n + 1; end if;
    end loop;
    return to_jsonb(n);

  when 'EXISTS' then
    n := 0;
    for i in 2..nargs loop if dsa_kv.live(c[i]) is not null then n := n + 1; end if; end loop;
    return to_jsonb(n);

  when 'TYPE' then
    return to_jsonb(coalesce(dsa_kv.live(key), 'none'));

  when 'EXPIRE', 'PEXPIRE' then
    if dsa_kv.live(key) is null then return '0'; end if;
    exp_at := clock_timestamp() + make_interval(secs => (c[3]::numeric / case when op = 'PEXPIRE' then 1000 else 1 end)::double precision);
    if exp_at <= clock_timestamp() then delete from dsa_kv.keys where k = key; return '1'; end if;
    update dsa_kv.keys set exp = exp_at where k = key;
    return '1';

  when 'PERSIST' then
    if dsa_kv.live(key) is null then return '0'; end if;
    update dsa_kv.keys set exp = null where k = key and exp is not null;
    return case when found then '1' else '0' end;

  when 'TTL', 'PTTL' then
    if dsa_kv.live(key) is null then return '-2'; end if;
    exp_at := (select exp from dsa_kv.keys where k = key);
    if exp_at is null then return '-1'; end if;
    if op = 'TTL' then return to_jsonb(round(extract(epoch from exp_at - clock_timestamp()))::bigint); end if;
    return to_jsonb(round(extract(epoch from exp_at - clock_timestamp()) * 1000)::bigint);

  when 'DBSIZE' then
    return to_jsonb((select count(*) from dsa_kv.keys where exp is null or exp > clock_timestamp()));

  when 'SCAN' then
    -- The cursor is the last name returned, so a long walk never repeats or skips a record.
    last_key := case when c[2] = '0' then '' else convert_from(decode(substr(c[2], 2), 'hex'), 'UTF8') end;
    pat := null; cnt := 10; only_type := null;
    i := 3;
    while i <= nargs loop
      case upper(c[i])
        when 'MATCH' then pat := dsa_kv.glob(c[i + 1]);
        when 'COUNT' then cnt := greatest(1, least(c[i + 1]::int, 10000));
        when 'TYPE' then only_type := lower(c[i + 1]);
        else raise exception 'ERR syntax error';
      end case;
      i := i + 2;
    end loop;
    select coalesce(jsonb_agg(x.k order by x.k), '[]'), max(x.k), count(*) into res, prev, n from (
      select k from dsa_kv.keys
       where k > last_key and (exp is null or exp > clock_timestamp())
         and (pat is null or k like pat) and (only_type is null or t = only_type)
       order by k limit cnt
    ) x;
    return jsonb_build_array(case when n < cnt then '0' else 'k' || encode(convert_to(prev, 'UTF8'), 'hex') end, res);

  when 'PING' then return '"PONG"';

  -- How much the app's records take up, in bytes (for System health).
  when 'DSA.BYTES' then
    return to_jsonb((select sum(pg_total_relation_size(x))::bigint from unnest(array['dsa_kv.keys', 'dsa_kv.hash', 'dsa_kv.list', 'dsa_kv.sets', 'dsa_kv.zset']::regclass[]) x));

  -- ----- fields -----
  when 'HGET' then
    if not dsa_kv.has(key, 'hash') then return 'null'; end if;
    return coalesce(to_jsonb((select v from dsa_kv.hash where k = key and f = c[3])), 'null');

  when 'HMGET' then
    res := '[]';
    if not dsa_kv.has(key, 'hash') then
      for i in 3..nargs loop res := res || jsonb_build_array(null); end loop;
      return res;
    end if;
    for i in 3..nargs loop res := res || jsonb_build_array((select v from dsa_kv.hash where k = key and f = c[i])); end loop;
    return res;

  when 'HSET', 'HMSET' then
    if nargs < 4 or (nargs - 2) % 2 <> 0 then raise exception 'ERR wrong number of arguments for ''hset'' command'; end if;
    perform dsa_kv.need(key, 'hash');
    n := 0;
    i := 3;
    while i < nargs loop
      insert into dsa_kv.hash (k, f, v) values (key, c[i], coalesce(c[i + 1], ''))
        on conflict (k, f) do update set v = excluded.v
        returning (xmax = 0) into is_new;
      if is_new then n := n + 1; end if;
      i := i + 2;
    end loop;
    return case when op = 'HMSET' then '"OK"' else to_jsonb(n) end;

  when 'HSETNX' then
    perform dsa_kv.need(key, 'hash');
    insert into dsa_kv.hash (k, f, v) values (key, c[3], c[4]) on conflict (k, f) do nothing;
    return case when found then '1' else '0' end;

  when 'HGETALL' then
    if not dsa_kv.has(key, 'hash') then return '[]'; end if;
    return coalesce((select jsonb_agg(x order by n0, ord) from (
      select h.f as x, h.n as n0, 0 as ord from dsa_kv.hash h where h.k = key
      union all select h.v, h.n, 1 from dsa_kv.hash h where h.k = key) y), '[]');

  when 'HKEYS' then
    if not dsa_kv.has(key, 'hash') then return '[]'; end if;
    return coalesce((select jsonb_agg(f order by n) from dsa_kv.hash where k = key), '[]');

  when 'HVALS' then
    if not dsa_kv.has(key, 'hash') then return '[]'; end if;
    return coalesce((select jsonb_agg(v order by n) from dsa_kv.hash where k = key), '[]');

  when 'HLEN' then
    if not dsa_kv.has(key, 'hash') then return '0'; end if;
    return to_jsonb((select count(*) from dsa_kv.hash where k = key));

  when 'HEXISTS' then
    if not dsa_kv.has(key, 'hash') then return '0'; end if;
    return case when exists (select 1 from dsa_kv.hash where k = key and f = c[3]) then '1' else '0' end;

  when 'HDEL' then
    if not dsa_kv.has(key, 'hash') then return '0'; end if;
    delete from dsa_kv.hash where k = key and f = any (c[3:nargs]);
    get diagnostics n = row_count;
    perform dsa_kv.tidy(key, 'hash');
    return to_jsonb(n);

  when 'HINCRBY' then
    perform dsa_kv.need(key, 'hash');
    insert into dsa_kv.hash (k, f, v) values (key, c[3], dsa_kv.int_of(c[4])::text)
      on conflict (k, f) do update set v = (dsa_kv.int_of(dsa_kv.hash.v) + dsa_kv.int_of(c[4]))::text
      returning v::bigint into m;
    return to_jsonb(m);

  -- ----- lists -----
  when 'LPUSH', 'RPUSH' then
    perform dsa_kv.need(key, 'list');
    for i in 3..nargs loop
      if op = 'LPUSH' then
        base := coalesce((select pos from dsa_kv.list where k = key order by pos asc limit 1), 1) - 1;
      else
        base := coalesce((select pos from dsa_kv.list where k = key order by pos desc limit 1), -1) + 1;
      end if;
      insert into dsa_kv.list (k, pos, v) values (key, base, c[i]);
    end loop;
    return to_jsonb((select count(*) from dsa_kv.list where k = key));

  when 'LLEN' then
    if not dsa_kv.has(key, 'list') then return '0'; end if;
    return to_jsonb((select count(*) from dsa_kv.list where k = key));

  when 'LRANGE' then
    if not dsa_kv.has(key, 'list') then return '[]'; end if;
    n := (select count(*) from dsa_kv.list where k = key);
    rng := dsa_kv.span(n, c[3]::bigint, c[4]::bigint);
    if rng is null then return '[]'; end if;
    return coalesce((select jsonb_agg(v order by pos) from (
      select pos, v from dsa_kv.list where k = key order by pos offset rng[1] limit rng[2] - rng[1] + 1) x), '[]');

  when 'LINDEX' then
    if not dsa_kv.has(key, 'list') then return 'null'; end if;
    n := (select count(*) from dsa_kv.list where k = key);
    m := c[3]::bigint; if m < 0 then m := n + m; end if;
    if m < 0 or m >= n then return 'null'; end if;
    return to_jsonb((select v from dsa_kv.list where k = key order by pos offset m limit 1));

  when 'LTRIM' then
    if not dsa_kv.has(key, 'list') then return '"OK"'; end if;
    n := (select count(*) from dsa_kv.list where k = key);
    rng := dsa_kv.span(n, c[3]::bigint, c[4]::bigint);
    if rng is null then
      delete from dsa_kv.keys where k = key;
      return '"OK"';
    end if;
    if rng[1] > 0 then
      delete from dsa_kv.list where k = key and pos < (select pos from dsa_kv.list where k = key order by pos offset rng[1] limit 1);
    end if;
    if rng[2] < n - 1 then
      -- after the first delete, the item that was at rng[2] is now at rng[2] - rng[1]
      delete from dsa_kv.list where k = key and pos > (select pos from dsa_kv.list where k = key order by pos offset rng[2] - rng[1] limit 1);
    end if;
    return '"OK"';

  when 'LPOP', 'RPOP' then
    if not dsa_kv.has(key, 'list') then return 'null'; end if;
    if op = 'LPOP' then
      delete from dsa_kv.list where k = key and pos = (select pos from dsa_kv.list where k = key order by pos asc limit 1) returning v into val;
    else
      delete from dsa_kv.list where k = key and pos = (select pos from dsa_kv.list where k = key order by pos desc limit 1) returning v into val;
    end if;
    perform dsa_kv.tidy(key, 'list');
    return to_jsonb(val);

  when 'LREM' then
    if not dsa_kv.has(key, 'list') then return '0'; end if;
    m := c[3]::bigint;
    if m > 0 then
      delete from dsa_kv.list where k = key and pos in (select pos from dsa_kv.list where k = key and v = c[4] order by pos asc limit m);
    elsif m < 0 then
      delete from dsa_kv.list where k = key and pos in (select pos from dsa_kv.list where k = key and v = c[4] order by pos desc limit -m);
    else
      delete from dsa_kv.list where k = key and v = c[4];
    end if;
    get diagnostics n = row_count;
    perform dsa_kv.tidy(key, 'list');
    return to_jsonb(n);

  -- ----- sets -----
  when 'SADD' then
    perform dsa_kv.need(key, 'set');
    insert into dsa_kv.sets (k, m) select key, x from unnest(c[3:nargs]) x on conflict do nothing;
    get diagnostics n = row_count;
    return to_jsonb(n);

  when 'SREM' then
    if not dsa_kv.has(key, 'set') then return '0'; end if;
    delete from dsa_kv.sets where k = key and m = any (c[3:nargs]);
    get diagnostics n = row_count;
    perform dsa_kv.tidy(key, 'set');
    return to_jsonb(n);

  when 'SMEMBERS' then
    if not dsa_kv.has(key, 'set') then return '[]'; end if;
    return coalesce((select jsonb_agg(m order by m) from dsa_kv.sets where k = key), '[]');

  when 'SISMEMBER' then
    if not dsa_kv.has(key, 'set') then return '0'; end if;
    return case when exists (select 1 from dsa_kv.sets where k = key and m = c[3]) then '1' else '0' end;

  when 'SCARD' then
    if not dsa_kv.has(key, 'set') then return '0'; end if;
    return to_jsonb((select count(*) from dsa_kv.sets where k = key));

  -- ----- scored sets -----
  when 'ZADD' then
    perform dsa_kv.need(key, 'zset');
    n := 0; i := 3;
    while i < nargs loop
      insert into dsa_kv.zset (k, m, score) values (key, c[i + 1], c[i]::double precision)
        on conflict (k, m) do update set score = excluded.score returning (xmax = 0) into is_new;
      if is_new then n := n + 1; end if;
      i := i + 2;
    end loop;
    return to_jsonb(n);

  when 'ZRANGE' then
    if not dsa_kv.has(key, 'zset') then return '[]'; end if;
    n := (select count(*) from dsa_kv.zset where k = key);
    rng := dsa_kv.span(n, c[3]::bigint, c[4]::bigint);
    if rng is null then return '[]'; end if;
    if nargs >= 5 and upper(c[5]) = 'WITHSCORES' then
      return coalesce((select jsonb_agg(z order by o1, o2, o3) from (
        select m as z, score as o1, m as o2, 0 as o3 from (select * from dsa_kv.zset where k = key order by score, m offset rng[1] limit rng[2] - rng[1] + 1) a
        union all
        select (case when score = trunc(score) and abs(score) < 1e15 then trunc(score)::bigint::text else score::text end), score, m, 1
          from (select * from dsa_kv.zset where k = key order by score, m offset rng[1] limit rng[2] - rng[1] + 1) b) y), '[]');
    end if;
    return coalesce((select jsonb_agg(m order by score, m) from (
      select * from dsa_kv.zset where k = key order by score, m offset rng[1] limit rng[2] - rng[1] + 1) x), '[]');

  when 'ZREM' then
    if not dsa_kv.has(key, 'zset') then return '0'; end if;
    delete from dsa_kv.zset where k = key and m = any (c[3:nargs]);
    get diagnostics n = row_count;
    perform dsa_kv.tidy(key, 'zset');
    return to_jsonb(n);

  when 'ZCARD' then
    if not dsa_kv.has(key, 'zset') then return '0'; end if;
    return to_jsonb((select count(*) from dsa_kv.zset where k = key));

  else
    raise exception 'ERR unknown command ''%''', c[1];
  end case;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- The one function the app calls: a list of commands in, one answer per command out.
-- POST /rest/v1/rpc/dsa_exec  { "cmds": [["GET","k"], ["HSET","h","f","v"], …] }
-- → [{"result": …}, {"error": "…"}, …]   (the same shape the key-value store answered with)
-- ---------------------------------------------------------------------------------------------------
create or replace function public.dsa_exec(cmds jsonb) returns jsonb
language plpgsql set search_path = dsa_kv, pg_temp as $$
declare
  res jsonb := '[]';
  item jsonb;
  args text[];
begin
  if jsonb_typeof(cmds) <> 'array' then raise exception 'cmds must be a list of commands'; end if;
  for item in select value from jsonb_array_elements(cmds) loop
    begin
      select array_agg(case when jsonb_typeof(x) = 'null' then null else x #>> '{}' end order by ord)
        into args from jsonb_array_elements(item) with ordinality as t(x, ord);
      res := res || jsonb_build_array(jsonb_build_object('result', dsa_kv.cmd(args)));
    exception when others then
      res := res || jsonb_build_array(jsonb_build_object('error', sqlerrm));
    end;
  end loop;
  -- Now and then, clear out records that have expired and were never read again.
  if random() < 0.02 then
    delete from dsa_kv.keys where k in (select k from dsa_kv.keys where exp < clock_timestamp() limit 500);
  end if;
  return res;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- Who may do what: only the secret (service_role) key, which only the app's server has.
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema dsa_kv from anon, authenticated';
    execute 'revoke all on all tables in schema dsa_kv from anon, authenticated';
    execute 'revoke all on all functions in schema dsa_kv from anon, authenticated';
    execute 'revoke all on function public.dsa_exec(jsonb) from anon, authenticated';
  end if;
  execute 'revoke all on schema dsa_kv from public';
  execute 'revoke all on all functions in schema dsa_kv from public';
  execute 'revoke all on function public.dsa_exec(jsonb) from public';
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema dsa_kv to service_role';
    execute 'grant all on all tables in schema dsa_kv to service_role';
    execute 'grant execute on all functions in schema dsa_kv to service_role';
    execute 'grant execute on function public.dsa_exec(jsonb) to service_role';
  end if;
end $$;

-- Tell the Data API about the new function straight away.
notify pgrst, 'reload schema';

select 'Ready: the Duda Site Auditor tables and dsa_exec are set up.' as result;
