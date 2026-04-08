import { useState, useEffect } from "react";
import axios from "axios";
import { useAuth } from "../context/AuthContext";
import { useRouter } from "next/router";
import toast from "react-hot-toast";
import { serverSideTranslations } from "next-i18next/pages/serverSideTranslations";

export async function getStaticProps({ locale }: { locale: string }) {
  return { props: { ...(await serverSideTranslations(locale, ["common", "agent", "auth"])) } };
}


export default function ManageUsers() {
  const { inviteUser, deleteUser, listUsers, updateUser, user } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const [users, setUsers] = useState<any[]>([]);
  const [email, setEmail] = useState("");

  const [editingUser, setEditingUser] = useState<any | null>(null);

  // Redirect if not logged in
  useEffect(() => {
    if (!user) router.push("/signin");
  }, [user, router]);

  const businessId = user?.business?.id;

  useEffect(() => {
    //axios.get(`/api/business/${businessId}/users`).then(res => setUsers(res.data));
    listUsers(Number(businessId)).then(data => setUsers(data));
  }, [businessId]);

  const inviteU = async () => {
    //await axios.post(`/api/business/${businessId}/invite`, { email });
    await inviteUser(Number(businessId), email);
    toast.success("Invite sent!");
    setEmail("");
  };

  const deleteU = async (userId: number) => {
    //await axios.delete(`/api/business/${businessId}/users/${userId}`);
    try {
      await deleteUser(Number(businessId), userId)
      setUsers(users.filter(u => u.id !== userId));
    } catch (e) {}
  };

  const saveUser = async (userId: number, updates: any) => {
    try {
      const updated = await updateUser(Number(businessId), userId, updates);
      setUsers(users.map(u => (u.id === userId ? updated : u)));
      setEditingUser(null);
      toast.success("User updated!");
    } catch (err) {
      toast.error("Update failed");
    }
  };

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Manage Users</h2>

      <div className="mb-4 flex space-x-2">
        <input
          type="email"
          placeholder="Enter email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="border p-2 rounded w-64"
        />
        <button onClick={inviteU} className="bg-blue-600 text-white px-4 py-2 rounded">
          Invite
        </button>
      </div>

      {/* Users list */}
      <ul className="space-y-2">
        {users.map((u) => (
          <li key={u.id} className="flex flex-col border p-2 rounded">
            {editingUser?.id === u.id ? (
              <div className="space-y-2">
                <input
                  type="text"
                  value={editingUser.full_name}
                  onChange={(e) => setEditingUser({ ...editingUser, full_name: e.target.value })}
                  className="border p-1 rounded"
                  placeholder="Full name"
                />
                {user.role === "admin" && (
                  <select
                    value={editingUser.role}
                    onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value })}
                    className="border p-1 rounded"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                )}
                <div className="space-x-2">
                  <button
                    onClick={() => saveUser(u.id, editingUser)}
                    className="bg-green-600 text-white px-3 py-1 rounded"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingUser(null)}
                    className="bg-gray-400 text-white px-3 py-1 rounded"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex justify-between items-center">
                <span>{u.full_name} ({u.email}) — {u.role}</span>
                <div className="space-x-2">
                  <button
                    onClick={() => setEditingUser({id: u.id, full_name: u.full_name, role: u.role}) /* setEditingUser(u) */}
                    className="bg-yellow-500 text-white px-3 py-1 rounded"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteU(u.id)}
                    className="bg-red-500 text-white px-3 py-1 rounded"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {/*< ul className="space-y-2">
        {users.map(u => (
          <li key={u.id} className="flex justify-between items-center border p-2 rounded">
            <span>{u.email} — {u.role}</span>
            <button
              onClick={() => deleteU(u.id)}
              className="bg-red-500 text-white px-3 py-1 rounded"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>*/}

    </div>
  );
}


function DeleteBusinessButton({ businessId }: { businessId: number }) {
  const deleteBusiness = async () => {
    if (!window.confirm("Are you sure? This will delete your entire business!")) return;
    await axios.delete(`/api/business/${businessId}`);
    alert("Business deleted");
    window.location.href = "/";
  };

  return (
    <button
      onClick={deleteBusiness}
      className="bg-red-700 text-white px-4 py-2 rounded mt-6"
    >
      Delete Business
    </button>
  );
}
