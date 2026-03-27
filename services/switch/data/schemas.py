from pydantic import BaseModel

# --- HTTP publish ---
class Message(BaseModel):
    sender: str
    content: str
    recipients: list[str]