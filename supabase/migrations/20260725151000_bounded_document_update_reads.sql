create or replace function public.openpencil_read_document_updates(
  p_document_id uuid,
  p_after_sequence bigint default 0,
  p_limit integer default 16
)
returns table (
  sequence bigint,
  client_update_id uuid,
  update_base64 text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  resolved_workspace_id uuid;
begin
  if p_after_sequence < 0 or p_limit < 1 or p_limit > 64 then
    raise exception 'Invalid OpenPencil update page'
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

  return query
  select
    document_update.sequence,
    document_update.client_update_id,
    document_update.update_base64
  from public.openpencil_document_updates document_update
  where document_update.document_id = p_document_id
    and document_update.sequence > p_after_sequence
  order by document_update.sequence asc
  limit p_limit;
end;
$$;

revoke all on function public.openpencil_read_document_updates(uuid, bigint, integer) from public;
grant execute on function public.openpencil_read_document_updates(uuid, bigint, integer)
  to authenticated;
