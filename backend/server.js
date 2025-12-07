// backend/server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose'); // ← 新增：引入 mongoose

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ 这里改成你自己的后台管理密码（以后在 admin 页面里要输入的）
const ADMIN_PASSWORD = '123';

app.use(cors());
app.use(express.json());

// =================== MongoDB 连接 ===================

// 优先使用环境变量中的 MONGODB_URI（Render 上配置）
// 本地没有环境变量时，自动退回到本机 MongoDB
const MONGODB_URI =
    process.env.MONGODB_URI ||
    'mongodb+srv://lele:Zhao1123@cluster0.uwfmmiy.mongodb.net/clothes_shop?appName=Cluster0';


mongoose
    .connect(MONGODB_URI)
    .then(() => {
        console.log('✅ MongoDB connected');
    })
    .catch((err) => {
        console.error('❌ MongoDB connection error:', err);
    });

// =================== MongoDB 订单模型 ===================

const orderSchema = new mongoose.Schema({
    id: { type: Number, index: true }, // 自增订单号
    customer: {
        name: String,
    },
    items: [
        {
            name: String,
            price: Number,
            quantity: Number,
        },
    ],
    status: { type: String, default: '已下单' },
    createdAt: { type: Date, default: Date.now },
});

const Order = mongoose.model('Order', orderSchema);

// =================== 商品文件相关 ===================

// 商品数据文件路径
const productsFilePath = path.join(__dirname, 'products.json');

// 读取商品列表
function loadProducts() {
    const data = fs.readFileSync(productsFilePath, 'utf-8');
    return JSON.parse(data);
}

// =================== 正常给顾客用的接口 ===================

// 获取商品列表
app.get('/api/products', (req, res) => {
    try {
        const products = loadProducts();
        res.json(products);
    } catch (err) {
        console.error('读取商品失败:', err);
        res.status(500).json({ message: '服务器错误：无法读取商品列表' });
    }
});

// 创建订单（写入 MongoDB）
app.post('/api/orders', async (req, res) => {
    try {
        const { items, customer } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ message: '订单为空' });
        }
        // ✅ 只要求姓名
        if (!customer || !customer.name) {
            return res.status(400).json({ message: '请填写姓名' });
        }

        // 找到当前最大订单号，自增生成新的 id
        const lastOrder = await Order.findOne().sort({ id: -1 }).lean();
        const newId = lastOrder ? lastOrder.id + 1 : 1;

        const newOrder = await Order.create({
            id: newId,
            items,
            customer,
            status: '已下单',
        });

        console.log('收到新订单：', newOrder);

        res.json({
            message: '订单已创建（当前为测试环境，未实际发起支付）',
            orderId: newOrder.id,
        });
    } catch (err) {
        console.error('创建订单失败:', err);
        res.status(500).json({ message: '服务器错误：创建订单失败' });
    }
});

// =================== 老板后台接口 ===================

// （老板）获取所有订单（按下单顺序）
app.get('/api/admin/orders', async (req, res) => {
    const pwd = req.query.password;
    if (pwd !== ADMIN_PASSWORD) {
        return res.status(403).json({ message: '管理密码错误' });
    }

    try {
        const allOrders = await Order.find().sort({ id: 1 }).lean();
        res.json(allOrders);
    } catch (err) {
        console.error('获取订单失败:', err);
        res.status(500).json({ message: '无法获取订单列表' });
    }
});

// 新增商品
app.post('/api/admin/add-product', (req, res) => {
    const { password, name, price, stock, image, description } = req.body;

    if (password !== ADMIN_PASSWORD) {
        return res.status(403).json({ message: '管理密码错误' });
    }

    if (!name || price === undefined || price === '') {
        return res.status(400).json({ message: '请至少填写商品名和价格' });
    }

    let products;
    try {
        products = loadProducts();
    } catch (err) {
        console.error('读取商品失败:', err);
        return res.status(500).json({ message: '无法读取商品列表' });
    }

    const newId = products.length > 0 ? Math.max(...products.map((p) => p.id)) + 1 : 1;

    const newProduct = {
        id: newId,
        name,
        price: Number(price),
        stock: stock ? Number(stock) : 0,
        image: image || '',
        description: description || '',
    };

    products.push(newProduct);

    try {
        fs.writeFileSync(productsFilePath, JSON.stringify(products, null, 2), 'utf-8');
    } catch (err) {
        console.error('写入商品失败:', err);
        return res.status(500).json({ message: '无法保存新商品' });
    }

    res.json({ message: '新增商品成功', product: newProduct });
});

// 修改某个商品的库存
app.post('/api/admin/update-stock', (req, res) => {
    const { password, productId, stock } = req.body;

    if (password !== ADMIN_PASSWORD) {
        return res.status(403).json({ message: '管理密码错误' });
    }

    let products;
    try {
        products = loadProducts();
    } catch (err) {
        console.error('读取商品失败:', err);
        return res.status(500).json({ message: '无法读取商品列表' });
    }

    const pid = Number(productId);
    const p = products.find((prod) => prod.id === pid);
    if (!p) {
        return res.status(404).json({ message: `未找到商品ID：${productId}` });
    }

    p.stock = Number(stock);

    try {
        fs.writeFileSync(productsFilePath, JSON.stringify(products, null, 2), 'utf-8');
    } catch (err) {
        console.error('写入商品失败:', err);
        return res.status(500).json({ message: '无法更新库存' });
    }

    res.json({ message: `已将「${p.name}」库存改为 ${p.stock}` });
});

// 删除商品
app.post('/api/admin/delete-product', (req, res) => {
    const { password, productId } = req.body;

    if (password !== ADMIN_PASSWORD) {
        return res.status(403).json({ message: '管理密码错误' });
    }

    if (!productId) {
        return res.status(400).json({ message: '请填写商品ID' });
    }

    let products;
    try {
        products = loadProducts();
    } catch (err) {
        console.error('读取商品失败:', err);
        return res.status(500).json({ message: '无法读取商品列表' });
    }

    const pid = Number(productId);
    const index = products.findIndex((p) => p.id === pid);

    if (index === -1) {
        return res.status(404).json({ message: `未找到商品ID：${productId}` });
    }

    const removed = products.splice(index, 1)[0];

    try {
        fs.writeFileSync(productsFilePath, JSON.stringify(products, null, 2), 'utf-8');
    } catch (err) {
        console.error('写入商品失败:', err);
        return res.status(500).json({ message: '无法保存删除后的商品列表' });
    }

    res.json({ message: `已删除商品「${removed.name}」（ID：${removed.id}）` });
});

// =================== 静态前端页面 ===================

app.use('/', express.static(path.join(__dirname, '..', 'frontend')));

// =================== 订单相关附加接口 ===================

// 按 ID 查询单个订单（用户自己查）
app.get('/api/orders/:id', async (req, res) => {
    try {
        const orderId = Number(req.params.id);
        const order = await Order.findOne({ id: orderId }).lean();

        if (!order) {
            return res.status(404).json({ message: '订单不存在' });
        }

        res.json(order);
    } catch (err) {
        console.error('查询订单失败:', err);
        res.status(500).json({ message: '服务器错误' });
    }
});

// 姓名脱敏函数：小王撒 → 小**
function maskName(name) {
    if (!name) return '';
    if (name.length === 1) return name + '*';
    return name[0] + '*'.repeat(name.length - 1);
}

// 公开订单列表（主页展示用，姓名脱敏）
app.get('/api/public-orders', async (req, res) => {
    try {
        const allOrders = await Order.find().sort({ id: 1 }).lean();

        const maskedOrders = allOrders.map((order) => ({
            id: order.id,
            name: maskName(order.customer?.name),
            createdAt: order.createdAt,
            status: order.status || '已下单',
            items: (order.items || []).map((i) => `${i.name}×${i.quantity || 1}`),
        }));

        res.json(maskedOrders);
    } catch (err) {
        console.error('获取公开订单失败:', err);
        res.status(500).json({ message: '无法获取订单' });
    }
});

// 老板修改订单状态
app.post('/api/admin/update-order-status', async (req, res) => {
    try {
        const { password, orderId, status } = req.body;

        if (password !== ADMIN_PASSWORD) {
            return res.status(403).json({ message: '管理密码错误' });
        }

        const allowStatus = ['已下单', '已付款'];
        if (!allowStatus.includes(status)) {
            return res.status(400).json({ message: '不支持的状态值' });
        }

        const id = Number(orderId);
        const order = await Order.findOneAndUpdate(
            { id },
            { status },
            { new: true }
        ).lean();

        if (!order) {
            return res.status(404).json({ message: `未找到订单ID：${orderId}` });
        }

        res.json({ message: `订单 ${order.id} 状态已更新为「${status}」` });
    } catch (err) {
        console.error('更新订单状态失败:', err);
        res.status(500).json({ message: '服务器错误' });
    }
});

// 老板删除订单
app.post('/api/admin/delete-order', async (req, res) => {
    try {
        const { password, orderId } = req.body;

        if (password !== ADMIN_PASSWORD) {
            return res.status(403).json({ message: '管理密码错误' });
        }

        const id = Number(orderId);
        const removed = await Order.findOneAndDelete({ id }).lean();

        if (!removed) {
            return res.status(404).json({ message: `未找到订单ID：${orderId}` });
        }

        res.json({
            message: `已删除订单 ${removed.id}（${removed.customer?.name || ''}）`,
        });
    } catch (err) {
        console.error('删除订单失败:', err);
        res.status(500).json({ message: '服务器错误' });
    }
});

// 老板导出订单为 CSV（Excel 可直接打开）
app.get('/api/admin/export-orders', async (req, res) => {
    const pwd = req.query.password;
    if (pwd !== ADMIN_PASSWORD) {
        return res.status(403).send('管理密码错误');
    }

    // 转义函数，避免 CSV 解析问题
    const escape = (str) => {
        if (str === null || str === undefined) return '';
        str = String(str).replace(/"/g, '""');
        return `"${str}"`;
    };

    // CSV 表头
    let csv = '订单ID,姓名,状态,下单时间,商品名称\r\n';

    try {
        const orders = await Order.find().sort({ id: 1 }).lean();

        if (orders && orders.length > 0) {
            orders.forEach((order) => {
                const id = escape(order.id);
                const name = escape(order.customer?.name || '');
                const status = escape(order.status || '已下单');
                const time = escape(
                    order.createdAt
                        ? new Date(order.createdAt).toLocaleString()
                        : ''
                );

                if (Array.isArray(order.items) && order.items.length > 0) {
                    // 第一件商品保留所有信息
                    csv += [id, name, status, time, escape(order.items[0].name)].join(
                        ','
                    ) + '\r\n';

                    // 后续商品只显示商品列
                    for (let i = 1; i < order.items.length; i++) {
                        csv += ['', '', '', '', escape(order.items[i].name)].join(
                            ','
                        ) + '\r\n';
                    }
                } else {
                    // 没有商品也空着
                    csv += `${id},${name},${status},${time},""\r\n`;
                }
            });
        }

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader(
            'Content-Disposition',
            'attachment; filename="orders.csv"'
        );
        // 加上 BOM 让 Excel 正常显示中文
        res.send('\uFEFF' + csv);
    } catch (err) {
        console.error('导出订单失败:', err);
        res.status(500).send('导出失败');
    }
});

// =================== 启动服务器 ===================

app.listen(PORT, () => {
    console.log(`服务器已启动：http://localhost:${PORT}`);
});
