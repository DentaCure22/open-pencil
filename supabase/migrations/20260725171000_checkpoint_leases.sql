alter table public.openpencil_documents
  add column checkpoint_lease_id uuid,
  add column checkpoint_lease_until timestamptz;

create or replace function public.openpencil_claim_document_checkpoint(
  p_document_id uuid,
  p_lease_id uuid,
  p_lease_seconds integer default 45
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_workspace_id uuid;
  claimed_rows integer;
begin
  if p_lease_id is null or p_lease_seconds < 15 or p_lease_seconds > 300 then
    raise exception 'Invalid OpenPencil checkpoint lease'
      using errcode = '22023';
  end if;

  select document.workspace_id
  into resolved_workspace_id
  from public.openpencil_documents document
  where document.id = p_document_id;

  if resolved_workspace_id is null
    or not public.is_openpencil_workspace_member(resolved_workspace_id)
  then
    raise exception 'OpenPencil document is outside the current workspace'
      using errcode = '42501';
  end if;

  update public.openpencil_documents
  set checkpoint_lease_id = p_lease_id,
      checkpoint_lease_until = now() + make_interval(secs => p_lease_seconds)
  where id = p_document_id
    and (
      checkpoint_lease_id is null
      or checkpoint_lease_until is null
      or checkpoint_lease_until <= now()
      or checkpoint_lease_id = p_lease_id
    );

  get diagnostics claimed_rows = row_count;
  return claimed_rows = 1;
end;
$$;

create or replace function public.openpencil_checkpoint_document_with_lease(
  p_document_id uuid,
  p_snapshot_base64 text,
  p_covers_sequence bigint,
  p_lease_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_workspace_id uuid;
  maximum_sequence bigint;
  current_snapshot_sequence bigint;
  current_lease_id uuid;
  current_lease_until timestamptz;
begin
  select
    document.workspace_id,
    document.snapshot_sequence,
    document.checkpoint_lease_id,
    document.checkpoint_lease_until
  into
    resolved_workspace_id,
    current_snapshot_sequence,
    current_lease_id,
    current_lease_until
  from public.openpencil_documents document
  where document.id = p_document_id
  for update;

  if resolved_workspace_id is null
    or not public.is_openpencil_workspace_member(resolved_workspace_id)
  then
    raise exception 'OpenPencil document is outside the current workspace'
      using errcode = '42501';
  end if;

  if p_snapshot_base64 is null
    or octet_length(p_snapshot_base64) = 0
    or octet_length(p_snapshot_base64) > 33554432
  then
    raise exception 'Invalid OpenPencil checkpoint payload'
      using errcode = '22023';
  end if;

  select coalesce(max(document_update.sequence), current_snapshot_sequence)
  into maximum_sequence
  from public.openpencil_document_updates document_update
  where document_update.document_id = p_document_id;

  if p_covers_sequence > maximum_sequence then
    raise exception 'Checkpoint sequence exceeds the durable update log'
      using errcode = '22023';
  end if;

  if p_covers_sequence <= current_snapshot_sequence then
    update public.openpencil_documents
    set checkpoint_lease_id = null,
        checkpoint_lease_until = null
    where id = p_document_id
      and checkpoint_lease_id = p_lease_id;
    return false;
  end if;

  if p_lease_id is null
    or current_lease_id is distinct from p_lease_id
    or current_lease_until is null
    or current_lease_until <= now()
  then
    raise exception 'OpenPencil checkpoint lease is not held'
      using errcode = '55P03';
  end if;

  update public.openpencil_documents
  set snapshot_base64 = p_snapshot_base64,
      snapshot_sequence = p_covers_sequence,
      checkpoint_lease_id = null,
      checkpoint_lease_until = null,
      updated_at = now()
  where id = p_document_id;

  delete from public.openpencil_document_updates
  where document_id = p_document_id
    and sequence <= p_covers_sequence;

  return true;
end;
$$;

revoke all on function public.openpencil_claim_document_checkpoint(uuid, uuid, integer)
  from public;
grant execute on function public.openpencil_claim_document_checkpoint(uuid, uuid, integer)
  to authenticated;
revoke all on function public.openpencil_checkpoint_document_with_lease(uuid, text, bigint, uuid)
  from public;
grant execute on function public.openpencil_checkpoint_document_with_lease(uuid, text, bigint, uuid)
  to authenticated;
